export default class OPFS {
  constructor({ useSync = true, verbose = false } = {}) {
    this.useSync = useSync && 'createSyncAccessHandle' in FileSystemFileHandle
    this.verbose = verbose
    this.rootPromise = navigator.storage.getDirectory()

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
          // Ensure err.code is always a string
          if (typeof err.code !== 'string') {
            err.code = 'UNKNOWN'
          }
          throw err
        }
      }
    }
  }

  _enoent(path) {
    const err = new Error(`ENOENT: No such file or directory, ${path}`)
    err.code = 'ENOENT'
    return err
  }

  async _getHandle(path, opts = {}) {
    const parts = path.split('/').filter(Boolean)
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
    const parts = path.split('/').filter(Boolean)
    let dir = await this.rootPromise
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create: true })
    }
  }

  async rmdir(path) {
    const parts = path.split('/').filter(Boolean)
    const name = parts.pop()
    let dir = await this.rootPromise
    for (const part of parts) {
      try {
        dir = await dir.getDirectoryHandle(part)
      } catch {
        throw this._enoent(path)
      }
    }
    try {
      await dir.removeEntry(name, { recursive: true })
    } catch {
      throw this._enoent(path)
    }
  }

  async unlink(path) {
    const { dir, name, fileHandle } = await this._getHandle(path)
    if (!fileHandle) throw this._enoent(path)
    try {
      await dir.removeEntry(name)
    } catch {
      throw this._enoent(path)
    }
  }

  async readdir(path) {
    const parts = path.split('/').filter(Boolean)
    let dir = await this.rootPromise
    try {
      for (const part of parts) {
        dir = await dir.getDirectoryHandle(part)
      }
    } catch {
      throw this._enoent(path)
    }

    const entries = []
    for await (const [name] of dir.entries()) {
      entries.push(name)
    }
    return entries
  }

  async stat(path) {
    if (path === '/' || path === '') {
      return {
        type: 'dir',
        size: 0,
        mtime: new Date(0),
        mtimeMs: 0,
        isFile: () => false,
        isDirectory: () => true
      }
    }

    const parts = path.split('/').filter(Boolean)
    const name = parts.pop()
    let dir = await this.rootPromise

    for (const part of parts) {
      try {
        dir = await dir.getDirectoryHandle(part)
      } catch {
        throw this._enoent(path)
      }
    }

    try {
      const fileHandle = await dir.getFileHandle(name)
      const file = await fileHandle.getFile()
      const mtime = new Date(file.lastModified)
      return {
        type: 'file',
        size: file.size,
        mtime,
        mtimeMs: file.lastModified,
        isFile: () => true,
        isDirectory: () => false
      }
    } catch {
      try {
        await dir.getDirectoryHandle(name)
        return {
          type: 'dir',
          size: 0,
          mtime: new Date(0),
          mtimeMs: 0,
          isFile: () => false,
          isDirectory: () => true
        }
      } catch {
        throw this._enoent(path)
      }
    }
  }

  async rename(oldPath, newPath) {
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
    try {
      return await this.stat(path)
    } catch (err) {
      if (err.code === 'ENOENT') throw err
      throw this._enoent(path)
    }
  }

  async du(path) {
    const stat = await this.stat(path)
    return { path, size: stat.size }
  }
}
