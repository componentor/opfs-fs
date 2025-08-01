export default class OPFS {
  constructor({ useSync = true } = {}) {
    this.useSync = useSync && 'createSyncAccessHandle' in FileSystemFileHandle
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
      this[method] = this[method].bind(this)
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
      } catch {
        if (!opts.create) throw this._enoent(path)
        throw
      }
    }
    const name = parts[parts.length - 1]
    try {
      const fileHandle = await dir.getFileHandle(name, { create: opts.create })
      return { dir, name, fileHandle }
    } catch {
      if (!opts.create) return { dir, name, fileHandle: null }
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

  async mkdir(path, options = {}) {
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
    const { fileHandle } = await this._getHandle(path)
    if (!fileHandle) throw this._enoent(path)
    const file = await fileHandle.getFile()
    return {
      size: file.size,
      mtimeMs: file.lastModified,
      isFile: () => true,
      isDirectory: () => false
    }
  }

  async rename(oldPath, newPath) {
    const data = await this.readFile(oldPath)
    await this.writeFile(newPath, data)
    await this.unlink(oldPath)
  }

  async lstat(path) {
    // For now, same as stat
    return this.stat(path)
  }

  async symlink(target, filepath, opts) {
    const err = new Error('symlink() is not supported in OPFS')
    err.code = 'ENOTSUP'
    throw err
  }

  async readlink(filepath, opts) {
    const err = new Error('readlink() is not supported in OPFS')
    err.code = 'ENOTSUP'
    throw err
  }

  async backFile(path, opts) {
    try {
      return await this.stat(path)
    } catch (err) {
      if (err.code === 'ENOENT') throw err
      throw this._enoent(path)
    }
  }

  async du(path, opts) {
    const stat = await this.stat(path)
    return { path, size: stat.size }
  }
}
