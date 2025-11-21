export default class OPFS {
  constructor({ useSync = true, verbose = false } = {}) {
    this.useSync = useSync && 'createSyncAccessHandle' in FileSystemFileHandle
    this.verbose = verbose
    this.rootPromise = navigator.storage.getDirectory()
    this._dirCache = new Map()
    this._symlinkCache = null
    this._symlinkFile = '/.opfs-symlinks.json'
    this._symlinksDirty = false

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

  async _ensureParentDir(path) {
    const parts = path.split('/').filter(Boolean)
    if (parts.length < 2) return
    const parentPath = '/' + parts.slice(0, -1).join('/')
    await this.mkdir(parentPath)
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

  async _loadSymlinks() {
    if (this._symlinkCache !== null) return this._symlinkCache

    try {
      const { fileHandle } = await this._getHandle(this._symlinkFile)
      if (!fileHandle) {
        this._symlinkCache = {}
        return this._symlinkCache
      }

      const file = await fileHandle.getFile()
      const text = await file.text()
      this._symlinkCache = JSON.parse(text)
    } catch {
      this._symlinkCache = {}
    }

    return this._symlinkCache
  }

  async _saveSymlinks() {
    const data = JSON.stringify(this._symlinkCache, null, 2)
    const { fileHandle } = await this._getHandle(this._symlinkFile, { create: true })
    const buffer = new TextEncoder().encode(data)

    if (this.useSync) {
      const access = await fileHandle.createSyncAccessHandle()
      access.truncate(0)
      let written = 0
      while (written < buffer.length) {
        written += access.write(buffer.subarray(written), { at: written })
      }
      access.close()
    } else {
      const writable = await fileHandle.createWritable()
      await writable.write(buffer)
      await writable.close()
    }
    this._symlinksDirty = false
  }

  async _flushSymlinks() {
    if (this._symlinksDirty) {
      await this._saveSymlinks()
    }
  }

  async _resolveSymlink(path, maxDepth = 10) {
    const symlinks = await this._loadSymlinks()
    let currentPath = path
    let depth = 0

    while (symlinks[currentPath] && depth < maxDepth) {
      currentPath = symlinks[currentPath]
      depth++
    }

    if (depth >= maxDepth) {
      const err = new Error(`ELOOP: Too many symbolic links, ${path}`)
      err.code = 'ELOOP'
      throw err
    }

    return currentPath
  }

  async _isSymlink(path) {
    const symlinks = await this._loadSymlinks()
    return !!symlinks[path]
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
    path = await this._resolveSymlink(path)
    const { fileHandle } = await this._getHandle(path)
    if (!fileHandle) throw this._enoent(path)

    if (this.useSync) {
      const access = await fileHandle.createSyncAccessHandle()
      const size = access.getSize()
      const buffer = new Uint8Array(size)
      access.read(buffer)
      access.close()
      return options.encoding
        ? new TextDecoder(options.encoding).decode(buffer)
        : buffer
    } else {
      const file = await fileHandle.getFile()
      const buffer = new Uint8Array(await file.arrayBuffer())
      return options.encoding
        ? new TextDecoder(options.encoding).decode(buffer)
        : buffer
    }
  }

  async writeFile(path, data, options = {}) {
    path = this._normalize(path)
    path = await this._resolveSymlink(path)
    this._clearDirCache(path)

    const { fileHandle } = await this._getHandle(path, { create: true })
    const buffer = typeof data === 'string' ? new TextEncoder().encode(data) : data

    if (this.useSync) {
      const access = await fileHandle.createSyncAccessHandle()
      access.truncate(0)

      let written = 0
      while (written < buffer.length) {
        written += access.write(buffer.subarray(written), { at: written })
      }

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

    const isSymlink = await this._isSymlink(path)
    if (isSymlink) {
      const symlinks = await this._loadSymlinks()
      delete symlinks[path]
      this._symlinksDirty = true
      await this._flushSymlinks()
      return
    }

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
    path = await this._resolveSymlink(path)
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

    const symlinks = await this._loadSymlinks()
    const entries = []

    for await (const [name, handle] of dir.entries()) {
      if (name === this._symlinkFile.replace(/^\/+/, '')) continue

      const entryPath = path === '/' ? `/${name}` : `${path}/${name}`
      const isSymlink = !!symlinks[entryPath]

      if (options.withFileTypes) {
        entries.push({
          name,
          isFile: () => !isSymlink && handle.kind === 'file',
          isDirectory: () => !isSymlink && handle.kind === 'directory',
          isSymbolicLink: () => isSymlink
        })
      } else {
        entries.push(name)
      }
    }

    for (const [symlinkPath] of Object.entries(symlinks)) {
      const symlinkParts = symlinkPath.split('/').filter(Boolean)
      const symlinkParent = '/' + symlinkParts.slice(0, -1).join('/')

      if ((symlinkParent === path || (path === '/' && symlinkParts.length === 1))) {
        const name = symlinkParts[symlinkParts.length - 1]
        const alreadyExists = entries.some(e =>
          typeof e === 'string' ? e === name : e.name === name
        )

        if (!alreadyExists) {
          if (options.withFileTypes) {
            entries.push({
              name,
              isFile: () => false,
              isDirectory: () => false,
              isSymbolicLink: () => true
            })
          } else {
            entries.push(name)
          }
        }
      }
    }

    return entries
  }

  async stat(path) {
    path = this._normalize(path)
    path = await this._resolveSymlink(path)
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
      const mtime = file.lastModified ? new Date(file.lastModified) : defaultDate

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

    const isSymlink = await this._isSymlink(oldPath)
    if (isSymlink) {
      const symlinks = await this._loadSymlinks()
      const target = symlinks[oldPath]
      delete symlinks[oldPath]
      symlinks[newPath] = target
      this._symlinksDirty = true
      await this._flushSymlinks()
      return
    }

    const stat = await this.stat(oldPath)

    if (stat.isFile()) {
      const data = await this.readFile(oldPath)
      await this._ensureParentDir(newPath)
      await this.writeFile(newPath, data)
      await this.unlink(oldPath)
    } else if (stat.isDirectory()) {
      await this.mkdir(newPath)
      const entries = await this.readdir(oldPath)
      for (const entry of entries) {
        const oldEntry = `${oldPath}/${entry}`
        const newEntry = `${newPath}/${entry}`
        await this.rename(oldEntry, newEntry)
      }
      await this.rmdir(oldPath)
    } else {
      throw new Error(`Unsupported type for rename: ${oldPath}`)
    }
  }

  async lstat(path) {
    path = this._normalize(path)
    const isSymlink = await this._isSymlink(path)

    if (isSymlink) {
      const target = await this.readlink(path)
      return {
        type: 'symlink',
        target,
        size: target.length,
        mode: 0o120777,
        ctime: new Date(0),
        ctimeMs: 0,
        mtime: new Date(0),
        mtimeMs: 0,
        isFile: () => false,
        isDirectory: () => false,
        isSymbolicLink: () => true
      }
    }

    return this.stat(path)
  }

  async symlink(target, path) {
    path = this._normalize(path)
    target = this._normalize(target)

    const symlinks = await this._loadSymlinks()

    if (symlinks[path]) {
      const err = new Error(`EEXIST: File exists, ${path}`)
      err.code = 'EEXIST'
      throw err
    }

    try {
      await this.stat(path)
      const err = new Error(`EEXIST: File exists, ${path}`)
      err.code = 'EEXIST'
      throw err
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
    }

    symlinks[path] = target
    this._symlinksDirty = true
    await this._flushSymlinks()
    this._clearDirCache(path)
  }

  async readlink(path) {
    path = this._normalize(path)
    const symlinks = await this._loadSymlinks()

    if (!symlinks[path]) {
      const err = new Error(`EINVAL: Invalid argument, ${path}`)
      err.code = 'EINVAL'
      throw err
    }

    return symlinks[path]
  }

  async symlinkBatch(links) {
    const symlinks = await this._loadSymlinks()

    for (const { target, path } of links) {
      const normalizedPath = this._normalize(path)
      const normalizedTarget = this._normalize(target)

      if (symlinks[normalizedPath]) {
        const err = new Error(`EEXIST: File exists, ${normalizedPath}`)
        err.code = 'EEXIST'
        throw err
      }

      try {
        await this.stat(normalizedPath)
        const err = new Error(`EEXIST: File exists, ${normalizedPath}`)
        err.code = 'EEXIST'
        throw err
      } catch (err) {
        if (err.code !== 'ENOENT') throw err
      }

      symlinks[normalizedPath] = normalizedTarget
      this._clearDirCache(normalizedPath)
    }

    this._symlinksDirty = true
    await this._flushSymlinks()
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
