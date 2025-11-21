// Mock OPFS APIs for testing
class MockFileSystemFileHandle {
  constructor(name, content = new Uint8Array()) {
    this.kind = 'file'
    this.name = name
    this._content = content
    this._lastModified = Date.now()
  }

  async getFile() {
    return {
      size: this._content.length,
      lastModified: this._lastModified,
      arrayBuffer: async () => this._content.buffer,
      text: async () => new TextDecoder().decode(this._content)
    }
  }

  async createWritable() {
    return {
      write: async (data) => {
        this._content = new Uint8Array(data)
        this._lastModified = Date.now()
      },
      close: async () => {}
    }
  }

  async createSyncAccessHandle() {
    const handle = this
    return {
      getSize: () => handle._content.length,
      read: (buffer) => {
        buffer.set(handle._content)
        return handle._content.length
      },
      write: (data, options = {}) => {
        const at = options.at || 0
        if (at + data.length > handle._content.length) {
          const newContent = new Uint8Array(at + data.length)
          newContent.set(handle._content)
          handle._content = newContent
        }
        handle._content.set(data, at)
        handle._lastModified = Date.now()
        return data.length
      },
      truncate: (size) => {
        handle._content = new Uint8Array(size)
      },
      close: () => {}
    }
  }
}

class MockFileSystemDirectoryHandle {
  constructor(name) {
    this.kind = 'directory'
    this.name = name
    this._entries = new Map()
  }

  async getFileHandle(name, options = {}) {
    if (this._entries.has(name)) {
      const entry = this._entries.get(name)
      if (entry.kind === 'file') return entry
      throw new DOMException('TypeMismatchError')
    }
    if (options.create) {
      const handle = new MockFileSystemFileHandle(name)
      this._entries.set(name, handle)
      return handle
    }
    throw new DOMException('NotFoundError')
  }

  async getDirectoryHandle(name, options = {}) {
    if (this._entries.has(name)) {
      const entry = this._entries.get(name)
      if (entry.kind === 'directory') return entry
      throw new DOMException('TypeMismatchError')
    }
    if (options.create) {
      const handle = new MockFileSystemDirectoryHandle(name)
      this._entries.set(name, handle)
      return handle
    }
    throw new DOMException('NotFoundError')
  }

  async removeEntry(name, options = {}) {
    if (!this._entries.has(name)) {
      throw new DOMException('NotFoundError')
    }
    const entry = this._entries.get(name)
    if (entry.kind === 'directory' && entry._entries.size > 0 && !options.recursive) {
      throw new DOMException('InvalidModificationError')
    }
    this._entries.delete(name)
  }

  async *entries() {
    for (const [name, handle] of this._entries) {
      yield [name, handle]
    }
  }
}

// Setup global mocks
global.FileSystemFileHandle = MockFileSystemFileHandle
global.FileSystemDirectoryHandle = MockFileSystemDirectoryHandle

const rootHandle = new MockFileSystemDirectoryHandle('root')

global.navigator = {
  storage: {
    getDirectory: async () => rootHandle
  }
}

// Reset the root directory before each test
export function resetFileSystem() {
  rootHandle._entries.clear()
}

// Make resetFileSystem available globally
global.resetFileSystem = resetFileSystem
