import { normalize, segments, dirname } from './path-utils.js'
import { createENOENT } from './errors.js'

export interface HandleResult {
  dir: FileSystemDirectoryHandle
  name: string
  fileHandle: FileSystemFileHandle | null
  dirHandle: FileSystemDirectoryHandle | null
}

export interface GetHandleOptions {
  create?: boolean
  kind?: 'file' | 'directory'
}

/**
 * Manages OPFS handles with caching for improved performance
 */
export class HandleManager {
  private rootPromise: Promise<FileSystemDirectoryHandle>
  private dirCache: Map<string, FileSystemDirectoryHandle> = new Map()

  constructor() {
    this.rootPromise = navigator.storage.getDirectory()
  }

  /**
   * Get the root directory handle
   */
  async getRoot(): Promise<FileSystemDirectoryHandle> {
    return this.rootPromise
  }

  /**
   * Clear directory cache for a path and its children
   */
  clearCache(path = ''): void {
    const normalizedPath = normalize(path)
    for (const key of this.dirCache.keys()) {
      if (key === normalizedPath || key.startsWith(normalizedPath + '/')) {
        this.dirCache.delete(key)
      }
    }
  }

  /**
   * Get file or directory handle for a path
   */
  async getHandle(path: string, opts: GetHandleOptions = {}): Promise<HandleResult> {
    const cleanPath = path.replace(/^\/+/, '')
    const parts = cleanPath.split('/').filter(Boolean)
    let dir = await this.rootPromise

    // Navigate to parent directory
    for (let i = 0; i < parts.length - 1; i++) {
      try {
        dir = await dir.getDirectoryHandle(parts[i], { create: opts.create })
      } catch {
        if (!opts.create) throw createENOENT(path)
        throw createENOENT(path)
      }
    }

    const name = parts[parts.length - 1]

    try {
      if (opts.kind === 'directory') {
        const dirHandle = await dir.getDirectoryHandle(name, { create: opts.create })
        return { dir, name, fileHandle: null, dirHandle }
      } else {
        const fileHandle = await dir.getFileHandle(name, { create: opts.create })
        return { dir, name, fileHandle, dirHandle: null }
      }
    } catch {
      if (!opts.create) {
        return { dir, name, fileHandle: null, dirHandle: null }
      }
      throw createENOENT(path)
    }
  }

  /**
   * Get directory handle with caching
   */
  async getDirectoryHandle(path: string): Promise<FileSystemDirectoryHandle> {
    const normalizedPath = normalize(path)

    if (normalizedPath === '/' || normalizedPath === '') {
      return this.rootPromise
    }

    // Check cache first
    if (this.dirCache.has(normalizedPath)) {
      return this.dirCache.get(normalizedPath)!
    }

    const parts = segments(normalizedPath)
    let dir = await this.rootPromise
    let currentPath = ''

    for (const part of parts) {
      currentPath += '/' + part

      if (this.dirCache.has(currentPath)) {
        dir = this.dirCache.get(currentPath)!
        continue
      }

      dir = await dir.getDirectoryHandle(part)
      this.dirCache.set(currentPath, dir)
    }

    return dir
  }

  /**
   * Ensure parent directory exists
   */
  async ensureParentDir(path: string): Promise<void> {
    const parentPath = dirname(path)
    if (parentPath === '/' || parentPath === '') return

    const parts = segments(parentPath)
    let dir = await this.rootPromise

    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create: true })
    }
  }

  /**
   * Create directory (with automatic parent creation)
   */
  async mkdir(path: string): Promise<void> {
    const normalizedPath = normalize(path)
    this.clearCache(normalizedPath)

    const parts = segments(normalizedPath)
    let dir = await this.rootPromise

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const subPath = '/' + parts.slice(0, i + 1).join('/')

      if (this.dirCache.has(subPath)) {
        dir = this.dirCache.get(subPath)!
      } else {
        dir = await dir.getDirectoryHandle(part, { create: true })
        this.dirCache.set(subPath, dir)
      }
    }
  }
}
