import type { SymlinkCache, SymlinkDefinition } from './types.js'
import type { HandleManager } from './handle-manager.js'
import { normalize } from './path-utils.js'
import { createELOOP, createEINVAL, createEEXIST } from './errors.js'

const SYMLINK_FILE = '/.opfs-symlinks.json'
const MAX_SYMLINK_DEPTH = 10

/**
 * Manages symbolic link emulation using a JSON metadata file
 */
export class SymlinkManager {
  private cache: SymlinkCache | null = null
  private cacheCount = 0 // Track count to avoid Object.keys() calls
  private dirty = false
  private handleManager: HandleManager
  private useSync: boolean

  constructor(handleManager: HandleManager, useSync: boolean) {
    this.handleManager = handleManager
    this.useSync = useSync
  }

  /**
   * Load symlinks from metadata file
   */
  async load(): Promise<SymlinkCache> {
    if (this.cache !== null) return this.cache

    try {
      const { fileHandle } = await this.handleManager.getHandle(SYMLINK_FILE)
      if (!fileHandle) {
        this.cache = {}
        this.cacheCount = 0
        return this.cache
      }

      const file = await fileHandle.getFile()
      const text = await file.text()
      this.cache = JSON.parse(text)
      this.cacheCount = Object.keys(this.cache).length
    } catch {
      this.cache = {}
      this.cacheCount = 0
    }

    return this.cache
  }

  /**
   * Save symlinks to metadata file
   */
  async save(): Promise<void> {
    if (!this.cache) return

    // Use compact JSON (no formatting) for better performance
    const data = JSON.stringify(this.cache)
    const { fileHandle } = await this.handleManager.getHandle(SYMLINK_FILE, { create: true })

    if (!fileHandle) return

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

    this.dirty = false
  }

  /**
   * Flush pending changes if dirty
   */
  async flush(): Promise<void> {
    if (this.dirty) {
      await this.save()
    }
  }

  /**
   * Resolve a path through symlinks
   * Fast synchronous path when cache is already loaded
   */
  async resolve(path: string, maxDepth = MAX_SYMLINK_DEPTH): Promise<string> {
    // Fast path: if cache is loaded and empty, return path directly (O(1) check)
    if (this.cache !== null) {
      // Skip resolution entirely if no symlinks exist (common case)
      if (this.cacheCount === 0) {
        return path
      }
      return this.resolveSync(path, this.cache, maxDepth)
    }

    const symlinks = await this.load()
    // Skip resolution entirely if no symlinks exist (common case)
    if (this.cacheCount === 0) {
      return path
    }
    return this.resolveSync(path, symlinks, maxDepth)
  }

  /**
   * Synchronous resolution helper
   */
  private resolveSync(path: string, symlinks: SymlinkCache, maxDepth: number): string {
    let currentPath = path
    let depth = 0

    while (symlinks[currentPath] && depth < maxDepth) {
      currentPath = symlinks[currentPath]
      depth++
    }

    if (depth >= maxDepth) {
      throw createELOOP(path)
    }

    return currentPath
  }

  /**
   * Check if a path is a symlink
   */
  async isSymlink(path: string): Promise<boolean> {
    const symlinks = await this.load()
    return !!symlinks[path]
  }

  /**
   * Get symlink target
   */
  async readlink(path: string): Promise<string> {
    const normalizedPath = normalize(path)
    const symlinks = await this.load()

    if (!symlinks[normalizedPath]) {
      throw createEINVAL(path)
    }

    return symlinks[normalizedPath]
  }

  /**
   * Create a symlink
   */
  async symlink(target: string, path: string, checkExists: () => Promise<void>): Promise<void> {
    const normalizedPath = normalize(path)
    const normalizedTarget = normalize(target)

    const symlinks = await this.load()

    if (symlinks[normalizedPath]) {
      throw createEEXIST(normalizedPath)
    }

    await checkExists()

    symlinks[normalizedPath] = normalizedTarget
    this.cacheCount++
    this.dirty = true
    await this.flush()
  }

  /**
   * Create multiple symlinks efficiently
   */
  async symlinkBatch(
    links: SymlinkDefinition[],
    checkExists: (path: string) => Promise<void>
  ): Promise<void> {
    const symlinks = await this.load()

    for (const { target, path } of links) {
      const normalizedPath = normalize(path)
      const normalizedTarget = normalize(target)

      if (symlinks[normalizedPath]) {
        throw createEEXIST(normalizedPath)
      }

      await checkExists(normalizedPath)

      symlinks[normalizedPath] = normalizedTarget
    }

    this.cacheCount += links.length
    this.dirty = true
    await this.flush()
  }

  /**
   * Remove a symlink
   */
  async unlink(path: string): Promise<boolean> {
    const symlinks = await this.load()

    if (symlinks[path]) {
      delete symlinks[path]
      this.cacheCount--
      this.dirty = true
      await this.flush()
      return true
    }

    return false
  }

  /**
   * Rename/move a symlink
   */
  async rename(oldPath: string, newPath: string): Promise<boolean> {
    const symlinks = await this.load()

    if (symlinks[oldPath]) {
      const target = symlinks[oldPath]
      delete symlinks[oldPath]
      symlinks[newPath] = target
      this.dirty = true
      await this.flush()
      return true
    }

    return false
  }

  /**
   * Get all symlinks in a directory
   */
  async getSymlinksInDir(dirPath: string): Promise<string[]> {
    const symlinks = await this.load()
    const result: string[] = []

    for (const symlinkPath of Object.keys(symlinks)) {
      const parts = symlinkPath.split('/').filter(Boolean)
      const parentPath = '/' + parts.slice(0, -1).join('/')

      if (parentPath === dirPath || (dirPath === '/' && parts.length === 1)) {
        result.push(parts[parts.length - 1])
      }
    }

    return result
  }

  /**
   * Check if path is the symlink metadata file
   */
  isMetadataFile(name: string): boolean {
    return name === SYMLINK_FILE.replace(/^\/+/, '')
  }
}
