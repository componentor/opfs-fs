export default class OPFS {
  constructor({ useSync = true, verbose = false } = {}) {
    this.useSync = useSync && 'createSyncAccessHandle' in FileSystemFileHandle
    this.verbose = verbose
    this.rootPromise = navigator.storage.getDirectory()
    this._dirCache = new Map()

    for (const method of [
      'readFile',
      'writeFile',
      'mkdir',
      'rmdir',
      'unlink',
      'readdir',
      'stat',
      'rename',
      'lstat',
      'symlink',
      'readlink',
      'backFile',
      'du'
    ]) {
      const original = this[method].bind(this)
      this[method] = async (...args) => {
        if (this.verbose) console.log(`[OPFS] ${method} called with args:`, args)
        try {
          const result = await original(...args)
          if (this.verbose) console.log(`[OPFS] ${method} returned:`, result)
          return result
        } catch (err) {
          if (this.verbose) console.error(`[OPFS] ${method} threw error:`, err)
          if (typeof err.code !== 'string') {
            const error = new Error(err.message)
            error.code = 'UNKNOWN'
            error.original = err
            throw error
          }
          throw err
        }
      }
    }
  }

  _normalize(path) {
    if (typeof path !== 'string') throw new TypeError('Expected string path')

    const parts = path.split('/')
    const stack = []

    for (const part of parts) {
      if (part === '' || part === '.') {
        continue
      } else if (part === '..') {
        if (stack.length > 0) stack.pop()
      } else {
        stack.push(part)
      }
    }

    return '/' + stack.join('/')
  }

  _enoent(path) {
    const err = new Error(`ENOENT: No such file or directory, ${path}`)
    err.code = 'ENOENT'
    return err
  }

  _clearDirCache(path = '') {
    path = this._normalize(path)
    for (const key of this._dirCache.keys()) {
      if (key === path || key.startsWith(path + '/')) {
        this._dirCache.delete(key)
      }
    }
  }

  async _getHandle(path, opts = {}) {
    const cleanPath = path.replace(/^\/+/, '')
    const parts = cleanPath.split('/').filter(Boolean)
    let dir = await this.rootPromise

    for (let i = 0; i < parts.length - 1; i++) {
      try {
        dir = await dir.getDirectoryHandle(parts[i], { create: opts.create })
      } catch (err) {
        if (!opts.create) throw this._enoent(path)
        throw err
      }
    }

    const name = parts[parts.length - 1]

    try {
      if (opts.kind === 'directory') {
        const dirHandle = await dir.getDirectoryHandle(name, { create: opts.create })
        return { dir, name, dirHandle }
      } else {
        const fileHandle = await dir.getFileHandle(name, { create: opts.create })
        return { dir, name, fileHandle }
      }
    } catch (err) {
      if (!opts.create) return { dir, name, fileHandle: null, dirHandle: null }
      throw this._enoent(path)
    }
  }

  async readFile(path, options = {}) {
    path = this._normalize(path)
    const { fileHandle } = await this._getHandle(path)
    if (!fileHandle) throw this._enoent(path)

    if (this.useSync) {
      const access = await fileHandle.createSyncAccessHandle()
      const size = access.getSize()
      const buffer = new Uint8Array(size)
      access.read(buffer)
      access.close()
      return options.encoding === 'utf8'
        ? new TextDecoder().decode(buffer)
        : buffer
    } else {
      const file = await fileHandle.getFile()
      const buffer = new Uint8Array(await file.arrayBuffer())
      return options.encoding === 'utf8'
        ? new TextDecoder().decode(buffer)
        : buffer
    }
  }

  async writeFile(path, data, options = {}) {
    path = this._normalize(path)
    this._clearDirCache(path)

    const { fileHandle } = await this._getHandle(path, { create: true })
    const buffer = typeof data === 'string' ? new TextEncoder().encode(data) : data

    if (this.useSync) {
      const access = await fileHandle.createSyncAccessHandle()
      access.truncate(0)
      access.write(buffer)
      access.close()
    } else {
      const writable = await fileHandle.createWritable()
      await writable.write(buffer)
      await writable.close()
    }
  }

  async mkdir(path) {
    path = this._normalize(path)
    this._clearDirCache(path)

    const parts = path.split('/').filter(Boolean)
    let dir = await this.rootPromise
    for (const part of parts) {
      const subPath = '/' + parts.slice(0, parts.indexOf(part) + 1).join('/')
      if (this._dirCache.has(subPath)) {
        dir = this._dirCache.get(subPath)
      } else {
        dir = await dir.getDirectoryHandle(part, { create: true })
        this._dirCache.set(subPath, dir)
      }
    }
  }

  async rmdir(path) {
    path = this._normalize(path)
    this._clearDirCache(path)

    const limitConcurrency = async (items, maxConcurrent, taskFn) => {
      const queue = [...items]
      const results = []
      const workers = Array.from({ length: maxConcurrent }).map(async () => {
        while (queue.length) {
          const item = queue.shift()
          results.push(await taskFn(item))
        }
      })
      await Promise.all(workers)
      return results
    }

    if (path === '/' || path === '') {
      const root = await this.rootPromise

      // Collect all entries in root
      const entries = []
      for await (const [name] of root.entries()) {
        entries.push(name)
      }

      // Delete all entries in controlled concurrency batches
      await limitConcurrency(entries, 10, (name) =>
        root.removeEntry(name, { recursive: true })
      )
      return
    }

    const parts = path.split('/').filter(Boolean)
    const name = parts.pop()
    let dir = await this.rootPromise
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part)
    }

    try {
      await dir.removeEntry(name, { recursive: true })
    } catch {
      throw this._enoent(path)
    }
  }

  async unlink(path) {
    path = this._normalize(path)
    this._clearDirCache(path)

    const { dir, name, fileHandle } = await this._getHandle(path)
    if (!fileHandle) throw this._enoent(path)
    try {
      await dir.removeEntry(name)
    } catch {
      throw this._enoent(path)
    }
  }

  async readdir(path, options = {}) {
    path = this._normalize(path)
    const parts = path.split('/').filter(Boolean)
    let dir = await this.rootPromise

    for (let i = 0; i < parts.length; i++) {
      const currentPath = '/' + parts.slice(0, i + 1).join('/')
      if (this._dirCache.has(currentPath)) {
        dir = this._dirCache.get(currentPath)
        continue
      }
      dir = await dir.getDirectoryHandle(parts[i])
      this._dirCache.set(currentPath, dir)
    }

    const entries = []
    for await (const [name, handle] of dir.entries()) {
      if (options.withFileTypes) {
        entries.push({
          name,
          isFile: () => handle.kind === 'file',
          isDirectory: () => handle.kind === 'directory',
          isSymbolicLink: () => false
        })
      } else {
        entries.push(name)
      }
    }

    return entries
  }

  async stat(path) {
    path = this._normalize(path)
    const defaultDate = new Date(0)

    if (path === '/' || path === '') {
      return {
        type: 'dir',
        size: 0,
        mode: 0o040755,
        ctime: defaultDate,
        ctimeMs: 0,
        mtime: defaultDate,
        mtimeMs: 0,
        isFile: () => false,
        isDirectory: () => true,
        isSymbolicLink: () => false
      }
    }

    const parts = path.split('/').filter(Boolean)
    const name = parts.pop()
    let dir = await this.rootPromise

    for (let i = 0; i < parts.length; i++) {
      const currentPath = '/' + parts.slice(0, i + 1).join('/')
      if (this._dirCache.has(currentPath)) {
        dir = this._dirCache.get(currentPath)
        continue
      }
      try {
        dir = await dir.getDirectoryHandle(parts[i])
        this._dirCache.set(currentPath, dir)
      } catch {
        throw this._enoent(path)
      }
    }

    const [fileResult, dirResult] = await Promise.allSettled([
      dir.getFileHandle(name),
      dir.getDirectoryHandle(name)
    ])

    if (dirResult.status === 'fulfilled') {
      return {
        type: 'dir',
        size: 0,
        mode: 0o040755,
        ctime: defaultDate,
        ctimeMs: 0,
        mtime: defaultDate,
        mtimeMs: 0,
        isFile: () => false,
        isDirectory: () => true,
        isSymbolicLink: () => false
      }
    }

    if (fileResult.status === 'fulfilled') {
      const fileHandle = fileResult.value
      const file = await fileHandle.getFile()
      let mtime = new Date(file.lastModified ?? Date.now())
      if (isNaN(mtime.valueOf())) mtime = defaultDate

      return {
        type: 'file',
        size: file.size,
        mode: 0o100644,
        ctime: mtime,
        ctimeMs: mtime.getTime(),
        mtime,
        mtimeMs: mtime.getTime(),
        isFile: () => true,
        isDirectory: () => false,
        isSymbolicLink: () => false
      }
    }

    throw this._enoent(path)
  }

  async rename(oldPath, newPath) {
    oldPath = this._normalize(oldPath)
    newPath = this._normalize(newPath)
    this._clearDirCache(oldPath)
    this._clearDirCache(newPath)

    const data = await this.readFile(oldPath)
    await this.writeFile(newPath, data)
    await this.unlink(oldPath)
  }

  async lstat(path) {
    return this.stat(path)
  }

  async symlink() {
    const err = new Error('symlink() is not supported in OPFS')
    err.code = 'ENOTSUP'
    throw err
  }

  async readlink() {
    const err = new Error('readlink() is not supported in OPFS')
    err.code = 'ENOTSUP'
    throw err
  }

  async backFile(path) {
    path = this._normalize(path)
    try {
      return await this.stat(path)
    } catch (err) {
      if (err.code === 'ENOENT') throw err
      throw this._enoent(path)
    }
  }

  async du(path) {
    path = this._normalize(path)
    const stat = await this.stat(path)
    return { path, size: stat.size }
  }
}
