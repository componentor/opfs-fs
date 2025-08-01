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

  async _getHandle(path, opts = {}) {
    const parts = path.split('/').filter(Boolean)
    let dir = await this.rootPromise
    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i], { create: opts.create })
    }
    const name = parts[parts.length - 1]
    return {
      dir,
      name,
      fileHandle: await dir.getFileHandle(name, { create: opts.create }).catch(() => null)
    }
  }

  async readFile(path, options = {}) {
    const { fileHandle } = await this._getHandle(path)
    if (!fileHandle) throw new Error(`ENOENT: No such file ${path}`)

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
      dir = await dir.getDirectoryHandle(part)
    }
    await dir.removeEntry(name, { recursive: true })
  }

  async unlink(path) {
    const { dir, name } = await this._getHandle(path)
    await dir.removeEntry(name)
  }

  async readdir(path) {
    const parts = path.split('/').filter(Boolean)
    let dir = await this.rootPromise
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part)
    }
    const entries = []
    for await (const [name] of dir.entries()) {
      entries.push(name)
    }
    return entries
  }

  async stat(path) {
    const { fileHandle } = await this._getHandle(path)
    if (!fileHandle) throw new Error(`ENOENT: No such file ${path}`)
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

  // --- Additional stubs ---

  async lstat(filepath, opts) {
    return this.stat(filepath, opts)
  }

  async symlink(target, filepath, opts) {
    throw new Error('symlink() is not supported in OPFS')
  }

  async readlink(filepath, opts) {
    throw new Error('readlink() is not supported in OPFS')
  }

  async backFile(filepath, opts) {
    // Not standard; just return stat info or throw if not found
    try {
      return await this.stat(filepath)
    } catch {
      throw new Error(`ENOENT: No such file ${filepath}`)
    }
  }

  async du(filepath, opts) {
    const stat = await this.stat(filepath)
    return { filepath, size: stat.size }
  }
}
