// src/constants.ts
var constants = {
  // File access modes
  F_OK: 0,
  R_OK: 4,
  W_OK: 2,
  X_OK: 1,
  // Copy file flags
  COPYFILE_EXCL: 1,
  COPYFILE_FICLONE: 2,
  COPYFILE_FICLONE_FORCE: 4,
  // File open flags
  O_RDONLY: 0,
  O_WRONLY: 1,
  O_RDWR: 2,
  O_CREAT: 64,
  O_EXCL: 128,
  O_TRUNC: 512,
  O_APPEND: 1024,
  // File type masks
  S_IFMT: 61440,
  S_IFREG: 32768,
  S_IFDIR: 16384,
  S_IFLNK: 40960
};
function flagsToString(flags) {
  if (typeof flags === "string") return flags;
  const map = {
    [constants.O_RDONLY]: "r",
    [constants.O_WRONLY]: "w",
    [constants.O_RDWR]: "r+",
    [constants.O_CREAT | constants.O_WRONLY]: "w",
    [constants.O_CREAT | constants.O_WRONLY | constants.O_TRUNC]: "w",
    [constants.O_CREAT | constants.O_RDWR]: "w+",
    [constants.O_APPEND | constants.O_WRONLY]: "a",
    [constants.O_APPEND | constants.O_RDWR]: "a+"
  };
  return map[flags] || "r";
}

// src/errors.ts
var FSError = class extends Error {
  code;
  syscall;
  path;
  original;
  constructor(message, code, options) {
    super(message);
    this.name = "FSError";
    this.code = code;
    this.syscall = options?.syscall;
    this.path = options?.path;
    this.original = options?.original;
  }
};
function createENOENT(path) {
  return new FSError(`ENOENT: No such file or directory, '${path}'`, "ENOENT", { path });
}
function createEEXIST(path, operation) {
  const message = `EEXIST: File exists, '${path}'`;
  return new FSError(message, "EEXIST", { path });
}
function createEACCES(path, syscall) {
  return new FSError(`EACCES: permission denied, access '${path}'`, "EACCES", { syscall, path });
}
function createEISDIR(path, operation = "operation") {
  return new FSError(`EISDIR: illegal operation on a directory, ${operation} '${path}'`, "EISDIR", { path });
}
function createELOOP(path) {
  return new FSError(`ELOOP: Too many symbolic links, '${path}'`, "ELOOP", { path });
}
function createEINVAL(path) {
  return new FSError(`EINVAL: Invalid argument, '${path}'`, "EINVAL", { path });
}
function wrapError(err) {
  if (err instanceof FSError) return err;
  const error = err;
  if (typeof error.code === "string") {
    const fsErr = new FSError(error.message, error.code);
    fsErr.original = error;
    return fsErr;
  }
  const wrapped = new FSError(error.message || "Unknown error", "UNKNOWN");
  wrapped.original = error;
  return wrapped;
}

// src/path-utils.ts
function normalize(path) {
  if (path === void 0 || path === null) {
    throw new TypeError("Path cannot be undefined or null");
  }
  if (typeof path !== "string") {
    throw new TypeError(`Expected string path, got ${typeof path}`);
  }
  if (path === "") {
    return "/";
  }
  const parts = path.split("/");
  const stack = [];
  for (const part of parts) {
    if (part === "" || part === ".") {
      continue;
    } else if (part === "..") {
      if (stack.length > 0) stack.pop();
    } else {
      stack.push(part);
    }
  }
  return "/" + stack.join("/");
}
function dirname(path) {
  const normalized = normalize(path);
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length < 2) return "/";
  return "/" + parts.slice(0, -1).join("/");
}
function isRoot(path) {
  const normalized = normalize(path);
  return normalized === "/" || normalized === "";
}
function segments(path) {
  return normalize(path).split("/").filter(Boolean);
}

// src/handle-manager.ts
var HandleManager = class {
  rootPromise;
  dirCache = /* @__PURE__ */ new Map();
  constructor() {
    this.rootPromise = navigator.storage.getDirectory();
  }
  /**
   * Get the root directory handle
   */
  async getRoot() {
    return this.rootPromise;
  }
  /**
   * Clear directory cache for a path and its children
   */
  clearCache(path = "") {
    if (this.dirCache.size === 0) return;
    const normalizedPath = normalize(path);
    if (normalizedPath === "/" || normalizedPath === "") {
      this.dirCache.clear();
      return;
    }
    for (const key of this.dirCache.keys()) {
      if (key === normalizedPath || key.startsWith(normalizedPath + "/")) {
        this.dirCache.delete(key);
      }
    }
  }
  /**
   * Get file or directory handle for a path
   */
  async getHandle(path, opts = {}) {
    const cleanPath = path.replace(/^\/+/, "");
    const parts = cleanPath.split("/").filter(Boolean);
    let dir = await this.rootPromise;
    let currentPath = "";
    for (let i = 0; i < parts.length - 1; i++) {
      currentPath += "/" + parts[i];
      if (this.dirCache.has(currentPath)) {
        dir = this.dirCache.get(currentPath);
        continue;
      }
      try {
        dir = await dir.getDirectoryHandle(parts[i], { create: opts.create });
        this.dirCache.set(currentPath, dir);
      } catch {
        throw createENOENT(path);
      }
    }
    const name = parts[parts.length - 1];
    try {
      if (opts.kind === "directory") {
        const dirHandle = await dir.getDirectoryHandle(name, { create: opts.create });
        return { dir, name, fileHandle: null, dirHandle };
      } else {
        const fileHandle = await dir.getFileHandle(name, { create: opts.create });
        return { dir, name, fileHandle, dirHandle: null };
      }
    } catch {
      if (!opts.create) {
        return { dir, name, fileHandle: null, dirHandle: null };
      }
      throw createENOENT(path);
    }
  }
  /**
   * Get directory handle with caching
   */
  async getDirectoryHandle(path) {
    const normalizedPath = normalize(path);
    if (normalizedPath === "/" || normalizedPath === "") {
      return this.rootPromise;
    }
    if (this.dirCache.has(normalizedPath)) {
      return this.dirCache.get(normalizedPath);
    }
    const parts = segments(normalizedPath);
    let dir = await this.rootPromise;
    let currentPath = "";
    for (const part of parts) {
      currentPath += "/" + part;
      if (this.dirCache.has(currentPath)) {
        dir = this.dirCache.get(currentPath);
        continue;
      }
      dir = await dir.getDirectoryHandle(part);
      this.dirCache.set(currentPath, dir);
    }
    return dir;
  }
  /**
   * Ensure parent directory exists
   */
  async ensureParentDir(path) {
    const parentPath = dirname(path);
    if (parentPath === "/" || parentPath === "") return;
    const parts = segments(parentPath);
    let dir = await this.rootPromise;
    let currentPath = "";
    for (const part of parts) {
      currentPath += "/" + part;
      if (this.dirCache.has(currentPath)) {
        dir = this.dirCache.get(currentPath);
        continue;
      }
      dir = await dir.getDirectoryHandle(part, { create: true });
      this.dirCache.set(currentPath, dir);
    }
  }
  /**
   * Create directory (with automatic parent creation)
   */
  async mkdir(path) {
    const normalizedPath = normalize(path);
    this.clearCache(normalizedPath);
    const parts = segments(normalizedPath);
    let dir = await this.rootPromise;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const subPath = "/" + parts.slice(0, i + 1).join("/");
      if (this.dirCache.has(subPath)) {
        dir = this.dirCache.get(subPath);
      } else {
        dir = await dir.getDirectoryHandle(part, { create: true });
        this.dirCache.set(subPath, dir);
      }
    }
  }
};

// src/symlink-manager.ts
var SYMLINK_FILE = "/.opfs-symlinks.json";
var MAX_SYMLINK_DEPTH = 10;
var SymlinkManager = class {
  cache = null;
  cacheCount = 0;
  // Track count to avoid Object.keys() calls
  dirty = false;
  handleManager;
  useSync;
  constructor(handleManager, useSync) {
    this.handleManager = handleManager;
    this.useSync = useSync;
  }
  /**
   * Load symlinks from metadata file
   */
  async load() {
    if (this.cache !== null) return this.cache;
    try {
      const { fileHandle } = await this.handleManager.getHandle(SYMLINK_FILE);
      if (!fileHandle) {
        this.cache = {};
        this.cacheCount = 0;
        return this.cache;
      }
      const file = await fileHandle.getFile();
      const text = await file.text();
      this.cache = JSON.parse(text);
      this.cacheCount = Object.keys(this.cache).length;
    } catch {
      this.cache = {};
      this.cacheCount = 0;
    }
    return this.cache;
  }
  /**
   * Save symlinks to metadata file
   */
  async save() {
    if (!this.cache) return;
    const data = JSON.stringify(this.cache);
    const { fileHandle } = await this.handleManager.getHandle(SYMLINK_FILE, { create: true });
    if (!fileHandle) return;
    const buffer = new TextEncoder().encode(data);
    if (this.useSync) {
      const access = await fileHandle.createSyncAccessHandle();
      access.truncate(0);
      let written = 0;
      while (written < buffer.length) {
        written += access.write(buffer.subarray(written), { at: written });
      }
      access.close();
    } else {
      const writable = await fileHandle.createWritable();
      await writable.write(buffer);
      await writable.close();
    }
    this.dirty = false;
  }
  /**
   * Flush pending changes if dirty
   */
  async flush() {
    if (this.dirty) {
      await this.save();
    }
  }
  /**
   * Resolve a path through symlinks
   * Fast synchronous path when cache is already loaded
   */
  async resolve(path, maxDepth = MAX_SYMLINK_DEPTH) {
    if (this.cache !== null) {
      if (this.cacheCount === 0) {
        return path;
      }
      return this.resolveSync(path, this.cache, maxDepth);
    }
    const symlinks = await this.load();
    if (this.cacheCount === 0) {
      return path;
    }
    return this.resolveSync(path, symlinks, maxDepth);
  }
  /**
   * Synchronous resolution helper
   */
  resolveSync(path, symlinks, maxDepth) {
    let currentPath = path;
    let depth = 0;
    while (symlinks[currentPath] && depth < maxDepth) {
      currentPath = symlinks[currentPath];
      depth++;
    }
    if (depth >= maxDepth) {
      throw createELOOP(path);
    }
    return currentPath;
  }
  /**
   * Check if a path is a symlink
   */
  async isSymlink(path) {
    const symlinks = await this.load();
    return !!symlinks[path];
  }
  /**
   * Get symlink target
   */
  async readlink(path) {
    const normalizedPath = normalize(path);
    const symlinks = await this.load();
    if (!symlinks[normalizedPath]) {
      throw createEINVAL(path);
    }
    return symlinks[normalizedPath];
  }
  /**
   * Create a symlink
   */
  async symlink(target, path, checkExists) {
    const normalizedPath = normalize(path);
    const normalizedTarget = normalize(target);
    const symlinks = await this.load();
    if (symlinks[normalizedPath]) {
      throw createEEXIST(normalizedPath);
    }
    await checkExists();
    symlinks[normalizedPath] = normalizedTarget;
    this.cacheCount++;
    this.dirty = true;
    await this.flush();
  }
  /**
   * Create multiple symlinks efficiently
   */
  async symlinkBatch(links, checkExists) {
    const symlinks = await this.load();
    for (const { target, path } of links) {
      const normalizedPath = normalize(path);
      const normalizedTarget = normalize(target);
      if (symlinks[normalizedPath]) {
        throw createEEXIST(normalizedPath);
      }
      await checkExists(normalizedPath);
      symlinks[normalizedPath] = normalizedTarget;
    }
    this.cacheCount += links.length;
    this.dirty = true;
    await this.flush();
  }
  /**
   * Remove a symlink
   */
  async unlink(path) {
    const symlinks = await this.load();
    if (symlinks[path]) {
      delete symlinks[path];
      this.cacheCount--;
      this.dirty = true;
      await this.flush();
      return true;
    }
    return false;
  }
  /**
   * Rename/move a symlink
   */
  async rename(oldPath, newPath) {
    const symlinks = await this.load();
    if (symlinks[oldPath]) {
      const target = symlinks[oldPath];
      delete symlinks[oldPath];
      symlinks[newPath] = target;
      this.dirty = true;
      await this.flush();
      return true;
    }
    return false;
  }
  /**
   * Get all symlinks in a directory
   */
  async getSymlinksInDir(dirPath) {
    const symlinks = await this.load();
    const result = [];
    for (const symlinkPath of Object.keys(symlinks)) {
      const parts = symlinkPath.split("/").filter(Boolean);
      const parentPath = "/" + parts.slice(0, -1).join("/");
      if (parentPath === dirPath || dirPath === "/" && parts.length === 1) {
        result.push(parts[parts.length - 1]);
      }
    }
    return result;
  }
  /**
   * Check if path is the symlink metadata file
   */
  isMetadataFile(name) {
    return name === SYMLINK_FILE.replace(/^\/+/, "");
  }
};

// src/file-handle.ts
function createFileHandle(resolvedPath, initialPosition, context) {
  let position = initialPosition;
  return {
    fd: Math.floor(Math.random() * 1e6),
    async read(buffer, offset = 0, length = buffer.length, pos = null) {
      const readPos = pos !== null ? pos : position;
      const data = await context.readFile(resolvedPath);
      const bytesToRead = Math.min(length, data.length - readPos);
      buffer.set(data.subarray(readPos, readPos + bytesToRead), offset);
      if (pos === null) position += bytesToRead;
      return { bytesRead: bytesToRead, buffer };
    },
    async write(buffer, offset = 0, length = buffer.length, pos = null) {
      const writePos = pos !== null ? pos : position;
      let existingData = new Uint8Array(0);
      try {
        existingData = await context.readFile(resolvedPath);
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      const dataToWrite = buffer.subarray(offset, offset + length);
      const newSize = Math.max(existingData.length, writePos + length);
      const newData = new Uint8Array(newSize);
      newData.set(existingData, 0);
      newData.set(dataToWrite, writePos);
      await context.writeFile(resolvedPath, newData);
      if (pos === null) position += length;
      return { bytesWritten: length, buffer };
    },
    async close() {
    },
    async stat() {
      return context.stat(resolvedPath);
    },
    async truncate(len = 0) {
      return context.truncate(resolvedPath, len);
    },
    async sync() {
    },
    async datasync() {
    },
    async readFile(options) {
      return context.readFile(resolvedPath, options);
    },
    async writeFile(data, options) {
      return context.writeFile(resolvedPath, data, options);
    },
    async appendFile(data, options) {
      return context.appendFile(resolvedPath, data, options);
    },
    [Symbol.asyncDispose]: async function() {
    }
  };
}

// src/streams.ts
function createReadStream(path, options, context) {
  const { start = 0, end = Infinity, highWaterMark = 64 * 1024 } = options;
  let position = start;
  let closed = false;
  let cachedData = null;
  return new ReadableStream({
    async pull(controller) {
      if (closed) {
        controller.close();
        return;
      }
      try {
        if (cachedData === null) {
          cachedData = await context.readFile(path);
        }
        const endPos = Math.min(end, cachedData.length);
        const chunk = cachedData.subarray(position, Math.min(position + highWaterMark, endPos));
        if (chunk.length === 0 || position >= endPos) {
          controller.close();
          closed = true;
          cachedData = null;
          return;
        }
        position += chunk.length;
        controller.enqueue(chunk);
      } catch (err) {
        controller.error(err);
      }
    },
    cancel() {
      closed = true;
      cachedData = null;
    }
  });
}
function createWriteStream(path, options, context) {
  const { flags = "w", start = 0 } = options;
  const chunks = [];
  let position = start;
  return new WritableStream({
    async write(chunk) {
      chunks.push({ data: chunk, position });
      position += chunk.length;
    },
    async close() {
      let existingData = new Uint8Array(0);
      if (!flags.includes("w")) {
        try {
          existingData = await context.readFile(path);
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
        }
      }
      let maxSize = existingData.length;
      for (const { data, position: position2 } of chunks) {
        maxSize = Math.max(maxSize, position2 + data.length);
      }
      const finalData = new Uint8Array(maxSize);
      if (!flags.includes("w")) {
        finalData.set(existingData, 0);
      }
      for (const { data, position: position2 } of chunks) {
        finalData.set(data, position2);
      }
      await context.writeFile(path, finalData);
    }
  });
}

// src/index.ts
var OPFS = class {
  useSync;
  verbose;
  handleManager;
  symlinkManager;
  watchCallbacks = /* @__PURE__ */ new Map();
  tmpCounter = 0;
  /** File system constants */
  constants = constants;
  constructor(options = {}) {
    const { useSync = true, verbose = false } = options;
    this.useSync = useSync && typeof FileSystemFileHandle !== "undefined" && "createSyncAccessHandle" in FileSystemFileHandle.prototype;
    this.verbose = verbose;
    this.handleManager = new HandleManager();
    this.symlinkManager = new SymlinkManager(this.handleManager, this.useSync);
  }
  log(method, ...args) {
    if (this.verbose) {
      console.log(`[OPFS] ${method}:`, ...args);
    }
  }
  logError(method, err) {
    if (this.verbose) {
      console.error(`[OPFS] ${method} error:`, err);
    }
  }
  /**
   * Execute tasks with limited concurrency to avoid overwhelming the system
   * @param items - Array of items to process
   * @param maxConcurrent - Maximum number of concurrent operations (default: 10)
   * @param taskFn - Function to execute for each item
   */
  async limitConcurrency(items, maxConcurrent, taskFn) {
    if (items.length === 0) return;
    if (items.length <= 3) {
      for (const item of items) {
        await taskFn(item);
      }
      return;
    }
    const queue = [...items];
    const workers = Array.from({ length: Math.min(maxConcurrent, items.length) }).map(async () => {
      while (queue.length) {
        const item = queue.shift();
        if (item !== void 0) await taskFn(item);
      }
    });
    await Promise.all(workers);
  }
  /**
   * Read file contents
   */
  async readFile(path, options = {}) {
    this.log("readFile", path, options);
    try {
      const normalizedPath = normalize(path);
      const resolvedPath = await this.symlinkManager.resolve(normalizedPath);
      const { fileHandle } = await this.handleManager.getHandle(resolvedPath);
      if (!fileHandle) {
        throw createENOENT(path);
      }
      let buffer;
      if (this.useSync) {
        const access = await fileHandle.createSyncAccessHandle();
        const size = access.getSize();
        buffer = new Uint8Array(size);
        access.read(buffer);
        access.close();
      } else {
        const file = await fileHandle.getFile();
        buffer = new Uint8Array(await file.arrayBuffer());
      }
      return options.encoding ? new TextDecoder(options.encoding).decode(buffer) : buffer;
    } catch (err) {
      this.logError("readFile", err);
      throw wrapError(err);
    }
  }
  /**
   * Write data to a file
   */
  async writeFile(path, data, options = {}) {
    this.log("writeFile", path);
    try {
      const normalizedPath = normalize(path);
      const resolvedPath = await this.symlinkManager.resolve(normalizedPath);
      const { fileHandle } = await this.handleManager.getHandle(resolvedPath, { create: true });
      const buffer = typeof data === "string" ? new TextEncoder().encode(data) : data;
      if (this.useSync) {
        const access = await fileHandle.createSyncAccessHandle();
        access.truncate(0);
        let written = 0;
        while (written < buffer.length) {
          written += access.write(buffer.subarray(written), { at: written });
        }
        access.close();
      } else {
        const writable = await fileHandle.createWritable();
        await writable.write(buffer);
        await writable.close();
      }
    } catch (err) {
      this.logError("writeFile", err);
      throw wrapError(err);
    }
  }
  /**
   * Create a directory
   */
  async mkdir(path) {
    this.log("mkdir", path);
    try {
      await this.handleManager.mkdir(path);
    } catch (err) {
      this.logError("mkdir", err);
      throw wrapError(err);
    }
  }
  /**
   * Remove a directory
   */
  async rmdir(path) {
    this.log("rmdir", path);
    try {
      const normalizedPath = normalize(path);
      this.handleManager.clearCache(normalizedPath);
      if (isRoot(normalizedPath)) {
        const root = await this.handleManager.getRoot();
        const entries = [];
        for await (const [name2] of root.entries()) {
          entries.push(name2);
        }
        await this.limitConcurrency(
          entries,
          10,
          (name2) => root.removeEntry(name2, { recursive: true })
        );
        return;
      }
      const pathSegments = segments(normalizedPath);
      const name = pathSegments.pop();
      let dir = await this.handleManager.getRoot();
      for (const part of pathSegments) {
        dir = await dir.getDirectoryHandle(part);
      }
      try {
        await dir.removeEntry(name, { recursive: true });
      } catch {
        throw createENOENT(path);
      }
    } catch (err) {
      this.logError("rmdir", err);
      throw wrapError(err);
    }
  }
  /**
   * Remove a file or symlink
   */
  async unlink(path) {
    this.log("unlink", path);
    try {
      const normalizedPath = normalize(path);
      this.handleManager.clearCache(normalizedPath);
      const isSymlink = await this.symlinkManager.isSymlink(normalizedPath);
      if (isSymlink) {
        await this.symlinkManager.unlink(normalizedPath);
        return;
      }
      const { dir, name, fileHandle } = await this.handleManager.getHandle(normalizedPath);
      if (!fileHandle) throw createENOENT(path);
      try {
        await dir.removeEntry(name);
      } catch {
        throw createENOENT(path);
      }
    } catch (err) {
      this.logError("unlink", err);
      throw wrapError(err);
    }
  }
  /**
   * Read directory contents
   */
  async readdir(path, options) {
    this.log("readdir", path, options);
    try {
      const normalizedPath = normalize(path);
      const resolvedPath = await this.symlinkManager.resolve(normalizedPath);
      const dir = await this.handleManager.getDirectoryHandle(resolvedPath);
      const withFileTypes = options?.withFileTypes === true;
      const symlinksInDir = await this.symlinkManager.getSymlinksInDir(resolvedPath);
      const hasSymlinks = symlinksInDir.length > 0;
      const symlinkSet = hasSymlinks ? new Set(symlinksInDir) : null;
      const entryNames = /* @__PURE__ */ new Set();
      const entries = [];
      for await (const [name, handle] of dir.entries()) {
        if (this.symlinkManager.isMetadataFile(name)) continue;
        entryNames.add(name);
        if (withFileTypes) {
          const isSymlink = hasSymlinks && symlinkSet.has(name);
          entries.push({
            name,
            isFile: () => !isSymlink && handle.kind === "file",
            isDirectory: () => !isSymlink && handle.kind === "directory",
            isSymbolicLink: () => isSymlink
          });
        } else {
          entries.push(name);
        }
      }
      if (hasSymlinks) {
        for (const name of symlinksInDir) {
          if (!entryNames.has(name)) {
            if (withFileTypes) {
              entries.push({
                name,
                isFile: () => false,
                isDirectory: () => false,
                isSymbolicLink: () => true
              });
            } else {
              entries.push(name);
            }
          }
        }
      }
      return entries;
    } catch (err) {
      this.logError("readdir", err);
      throw wrapError(err);
    }
  }
  /**
   * Get file/directory statistics (follows symlinks)
   */
  async stat(path) {
    this.log("stat", path);
    try {
      const normalizedPath = normalize(path);
      const resolvedPath = await this.symlinkManager.resolve(normalizedPath);
      const defaultDate = /* @__PURE__ */ new Date(0);
      if (isRoot(resolvedPath)) {
        return {
          type: "dir",
          size: 0,
          mode: 16877,
          ctime: defaultDate,
          ctimeMs: 0,
          mtime: defaultDate,
          mtimeMs: 0,
          isFile: () => false,
          isDirectory: () => true,
          isSymbolicLink: () => false
        };
      }
      const pathSegments = segments(resolvedPath);
      const name = pathSegments.pop();
      let dir = await this.handleManager.getRoot();
      for (const part of pathSegments) {
        try {
          dir = await dir.getDirectoryHandle(part);
        } catch {
          throw createENOENT(path);
        }
      }
      const [fileResult, dirResult] = await Promise.allSettled([
        dir.getFileHandle(name),
        dir.getDirectoryHandle(name)
      ]);
      if (dirResult.status === "fulfilled") {
        return {
          type: "dir",
          size: 0,
          mode: 16877,
          ctime: defaultDate,
          ctimeMs: 0,
          mtime: defaultDate,
          mtimeMs: 0,
          isFile: () => false,
          isDirectory: () => true,
          isSymbolicLink: () => false
        };
      }
      if (fileResult.status === "fulfilled") {
        const fileHandle = fileResult.value;
        const file = await fileHandle.getFile();
        const mtime = file.lastModified ? new Date(file.lastModified) : defaultDate;
        return {
          type: "file",
          size: file.size,
          mode: 33188,
          ctime: mtime,
          ctimeMs: mtime.getTime(),
          mtime,
          mtimeMs: mtime.getTime(),
          isFile: () => true,
          isDirectory: () => false,
          isSymbolicLink: () => false
        };
      }
      throw createENOENT(path);
    } catch (err) {
      this.logError("stat", err);
      throw wrapError(err);
    }
  }
  /**
   * Get file/directory statistics (does not follow symlinks)
   */
  async lstat(path) {
    this.log("lstat", path);
    try {
      const normalizedPath = normalize(path);
      const isSymlink = await this.symlinkManager.isSymlink(normalizedPath);
      if (isSymlink) {
        const target = await this.symlinkManager.readlink(normalizedPath);
        return {
          type: "symlink",
          target,
          size: target.length,
          mode: 41471,
          ctime: /* @__PURE__ */ new Date(0),
          ctimeMs: 0,
          mtime: /* @__PURE__ */ new Date(0),
          mtimeMs: 0,
          isFile: () => false,
          isDirectory: () => false,
          isSymbolicLink: () => true
        };
      }
      return this.stat(path);
    } catch (err) {
      this.logError("lstat", err);
      throw wrapError(err);
    }
  }
  /**
   * Rename a file or directory
   */
  async rename(oldPath, newPath) {
    this.log("rename", oldPath, newPath);
    try {
      const normalizedOld = normalize(oldPath);
      const normalizedNew = normalize(newPath);
      this.handleManager.clearCache(normalizedOld);
      this.handleManager.clearCache(normalizedNew);
      const renamed = await this.symlinkManager.rename(normalizedOld, normalizedNew);
      if (renamed) return;
      const stat = await this.stat(normalizedOld);
      if (stat.isFile()) {
        const data = await this.readFile(normalizedOld);
        await this.handleManager.ensureParentDir(normalizedNew);
        await this.writeFile(normalizedNew, data);
        await this.unlink(normalizedOld);
      } else if (stat.isDirectory()) {
        await this.mkdir(normalizedNew);
        const entries = await this.readdir(normalizedOld);
        await this.limitConcurrency(
          entries,
          10,
          (entry) => this.rename(`${normalizedOld}/${entry}`, `${normalizedNew}/${entry}`)
        );
        await this.rmdir(normalizedOld);
      }
    } catch (err) {
      this.logError("rename", err);
      throw wrapError(err);
    }
  }
  /**
   * Create a symbolic link
   */
  async symlink(target, path) {
    this.log("symlink", target, path);
    try {
      const normalizedPath = normalize(path);
      this.handleManager.clearCache(normalizedPath);
      await this.symlinkManager.symlink(target, path, async () => {
        try {
          await this.stat(normalizedPath);
          throw createEEXIST(path);
        } catch (err) {
          if (err.code !== "ENOENT") throw err;
        }
      });
    } catch (err) {
      this.logError("symlink", err);
      throw wrapError(err);
    }
  }
  /**
   * Read symlink target
   */
  async readlink(path) {
    this.log("readlink", path);
    try {
      return await this.symlinkManager.readlink(path);
    } catch (err) {
      this.logError("readlink", err);
      throw wrapError(err);
    }
  }
  /**
   * Create multiple symlinks efficiently
   */
  async symlinkBatch(links) {
    this.log("symlinkBatch", links.length, "links");
    try {
      for (const { path } of links) {
        this.handleManager.clearCache(normalize(path));
      }
      await this.symlinkManager.symlinkBatch(links, async (normalizedPath) => {
        try {
          await this.stat(normalizedPath);
          throw createEEXIST(normalizedPath);
        } catch (err) {
          if (err.code !== "ENOENT") throw err;
        }
      });
    } catch (err) {
      this.logError("symlinkBatch", err);
      throw wrapError(err);
    }
  }
  /**
   * Check file accessibility
   */
  async access(path, mode = constants.F_OK) {
    this.log("access", path, mode);
    try {
      const normalizedPath = normalize(path);
      await this.stat(normalizedPath);
    } catch (err) {
      this.logError("access", err);
      throw createEACCES(path);
    }
  }
  /**
   * Append data to a file
   */
  async appendFile(path, data, options = {}) {
    this.log("appendFile", path);
    try {
      const normalizedPath = normalize(path);
      const resolvedPath = await this.symlinkManager.resolve(normalizedPath);
      let existingData = new Uint8Array(0);
      try {
        const result = await this.readFile(resolvedPath);
        existingData = result instanceof Uint8Array ? result : new TextEncoder().encode(result);
      } catch (err) {
        if (err.code !== "ENOENT") throw err;
      }
      const newData = typeof data === "string" ? new TextEncoder().encode(data) : data;
      const combined = new Uint8Array(existingData.length + newData.length);
      combined.set(existingData, 0);
      combined.set(newData, existingData.length);
      await this.writeFile(resolvedPath, combined, options);
    } catch (err) {
      this.logError("appendFile", err);
      throw wrapError(err);
    }
  }
  /**
   * Copy a file
   */
  async copyFile(src, dest, mode = 0) {
    this.log("copyFile", src, dest, mode);
    try {
      const normalizedSrc = normalize(src);
      const normalizedDest = normalize(dest);
      const resolvedSrc = await this.symlinkManager.resolve(normalizedSrc);
      if (mode & constants.COPYFILE_EXCL) {
        try {
          await this.stat(normalizedDest);
          throw createEEXIST(dest);
        } catch (err) {
          if (err.code !== "ENOENT") throw err;
        }
      }
      const data = await this.readFile(resolvedSrc);
      await this.handleManager.ensureParentDir(normalizedDest);
      await this.writeFile(normalizedDest, data);
    } catch (err) {
      this.logError("copyFile", err);
      throw wrapError(err);
    }
  }
  /**
   * Copy files/directories recursively
   */
  async cp(src, dest, options = {}) {
    this.log("cp", src, dest, options);
    try {
      const normalizedSrc = normalize(src);
      const normalizedDest = normalize(dest);
      const { recursive = false, force = false, errorOnExist = false } = options;
      const srcStat = await this.stat(normalizedSrc);
      if (srcStat.isDirectory()) {
        if (!recursive) {
          throw createEISDIR(src);
        }
        let destExists = false;
        try {
          await this.stat(normalizedDest);
          destExists = true;
          if (errorOnExist && !force) {
            throw createEEXIST(dest);
          }
        } catch (err) {
          if (err.code !== "ENOENT") throw err;
        }
        if (!destExists) {
          await this.mkdir(normalizedDest);
        }
        const entries = await this.readdir(normalizedSrc);
        await this.limitConcurrency(
          entries,
          10,
          (entry) => this.cp(`${normalizedSrc}/${entry}`, `${normalizedDest}/${entry}`, options)
        );
      } else {
        if (errorOnExist) {
          try {
            await this.stat(normalizedDest);
            throw createEEXIST(dest);
          } catch (err) {
            if (err.code !== "ENOENT") throw err;
          }
        }
        await this.copyFile(normalizedSrc, normalizedDest);
      }
    } catch (err) {
      this.logError("cp", err);
      throw wrapError(err);
    }
  }
  /**
   * Check if path exists
   */
  async exists(path) {
    this.log("exists", path);
    try {
      await this.stat(normalize(path));
      return true;
    } catch {
      return false;
    }
  }
  /**
   * Resolve symlinks to get real path
   */
  async realpath(path) {
    this.log("realpath", path);
    const normalizedPath = normalize(path);
    return this.symlinkManager.resolve(normalizedPath);
  }
  /**
   * Remove files and directories
   */
  async rm(path, options = {}) {
    this.log("rm", path, options);
    try {
      const normalizedPath = normalize(path);
      const { recursive = false, force = false } = options;
      try {
        const stat = await this.lstat(normalizedPath);
        if (stat.isSymbolicLink()) {
          await this.unlink(normalizedPath);
        } else if (stat.isDirectory()) {
          if (!recursive) {
            throw createEISDIR(path);
          }
          await this.rmdir(normalizedPath);
        } else {
          await this.unlink(normalizedPath);
        }
      } catch (err) {
        if (err.code === "ENOENT" && force) {
          return;
        }
        throw err;
      }
    } catch (err) {
      this.logError("rm", err);
      throw wrapError(err);
    }
  }
  /**
   * Truncate file to specified length
   */
  async truncate(path, len = 0) {
    this.log("truncate", path, len);
    try {
      const normalizedPath = normalize(path);
      const resolvedPath = await this.symlinkManager.resolve(normalizedPath);
      this.handleManager.clearCache(resolvedPath);
      const { fileHandle } = await this.handleManager.getHandle(resolvedPath);
      if (!fileHandle) throw createENOENT(path);
      if (this.useSync) {
        const access = await fileHandle.createSyncAccessHandle();
        access.truncate(len);
        access.close();
      } else {
        const file = await fileHandle.getFile();
        const data = new Uint8Array(await file.arrayBuffer());
        const finalData = new Uint8Array(len);
        const copyLen = Math.min(len, data.length);
        if (copyLen > 0) {
          finalData.set(data.subarray(0, copyLen), 0);
        }
        const writable = await fileHandle.createWritable();
        await writable.write(finalData);
        await writable.close();
      }
    } catch (err) {
      this.logError("truncate", err);
      throw wrapError(err);
    }
  }
  /**
   * Create a unique temporary directory
   */
  async mkdtemp(prefix) {
    this.log("mkdtemp", prefix);
    try {
      const normalizedPrefix = normalize(prefix);
      const suffix = `${Date.now()}-${++this.tmpCounter}-${Math.random().toString(36).slice(2, 8)}`;
      const path = `${normalizedPrefix}${suffix}`;
      await this.mkdir(path);
      return path;
    } catch (err) {
      this.logError("mkdtemp", err);
      throw wrapError(err);
    }
  }
  /**
   * Change file mode (no-op for OPFS compatibility)
   */
  async chmod(path, mode) {
    this.log("chmod", path, mode);
    await this.stat(normalize(path));
  }
  /**
   * Change file owner (no-op for OPFS compatibility)
   */
  async chown(path, uid, gid) {
    this.log("chown", path, uid, gid);
    await this.stat(normalize(path));
  }
  /**
   * Update file timestamps (no-op for OPFS compatibility)
   */
  async utimes(path, atime, mtime) {
    this.log("utimes", path, atime, mtime);
    await this.stat(normalize(path));
  }
  /**
   * Update symlink timestamps (no-op)
   */
  async lutimes(path, atime, mtime) {
    this.log("lutimes", path, atime, mtime);
    await this.lstat(normalize(path));
  }
  /**
   * Open file and return FileHandle
   */
  async open(path, flags = "r", mode = 438) {
    this.log("open", path, flags, mode);
    try {
      const normalizedPath = normalize(path);
      const flagStr = flagsToString(flags);
      const shouldCreate = flagStr.includes("w") || flagStr.includes("a") || flagStr.includes("+");
      const shouldTruncate = flagStr.includes("w");
      const shouldAppend = flagStr.includes("a");
      if (shouldCreate) {
        await this.handleManager.ensureParentDir(normalizedPath);
      }
      const resolvedPath = await this.symlinkManager.resolve(normalizedPath);
      const { fileHandle } = await this.handleManager.getHandle(resolvedPath, { create: shouldCreate });
      if (!fileHandle && !shouldCreate) {
        throw createENOENT(path);
      }
      if (shouldTruncate && fileHandle) {
        await this.truncate(resolvedPath, 0);
      }
      const initialPosition = shouldAppend ? (await this.stat(resolvedPath)).size : 0;
      return createFileHandle(resolvedPath, initialPosition, {
        readFile: (p, o) => this.readFile(p, o),
        writeFile: (p, d) => this.writeFile(p, d),
        stat: (p) => this.stat(p),
        truncate: (p, l) => this.truncate(p, l),
        appendFile: (p, d, o) => this.appendFile(p, d, o)
      });
    } catch (err) {
      this.logError("open", err);
      throw wrapError(err);
    }
  }
  /**
   * Open directory for iteration
   */
  async opendir(path) {
    this.log("opendir", path);
    try {
      const normalizedPath = normalize(path);
      const entries = await this.readdir(normalizedPath, { withFileTypes: true });
      let index = 0;
      return {
        path: normalizedPath,
        async read() {
          if (index >= entries.length) return null;
          return entries[index++];
        },
        async close() {
          index = entries.length;
        },
        async *[Symbol.asyncIterator]() {
          for (const entry of entries) {
            yield entry;
          }
        }
      };
    } catch (err) {
      this.logError("opendir", err);
      throw wrapError(err);
    }
  }
  /**
   * Watch for file changes
   */
  watch(path, options = {}) {
    this.log("watch", path, options);
    const normalizedPath = normalize(path);
    const { recursive = false, signal } = options;
    const callbacks = /* @__PURE__ */ new Set();
    const id = /* @__PURE__ */ Symbol("watcher");
    this.watchCallbacks.set(id, { path: normalizedPath, callbacks, recursive });
    if (signal) {
      signal.addEventListener("abort", () => {
        this.watchCallbacks.delete(id);
      });
    }
    const self = this;
    return {
      close() {
        self.watchCallbacks.delete(id);
      },
      ref() {
        return this;
      },
      unref() {
        return this;
      },
      [Symbol.asyncIterator]() {
        const queue = [];
        let resolver = null;
        callbacks.add((eventType, filename) => {
          const event = { eventType, filename };
          if (resolver) {
            resolver({ value: event, done: false });
            resolver = null;
          } else {
            queue.push(event);
          }
        });
        return {
          next() {
            if (queue.length > 0) {
              return Promise.resolve({ value: queue.shift(), done: false });
            }
            return new Promise((resolve) => {
              resolver = resolve;
            });
          },
          return() {
            return Promise.resolve({ done: true, value: void 0 });
          }
        };
      }
    };
  }
  /**
   * Create read stream
   */
  createReadStream(path, options = {}) {
    this.log("createReadStream", path, options);
    const normalizedPath = normalize(path);
    return createReadStream(normalizedPath, options, {
      readFile: (p) => this.readFile(p)
    });
  }
  /**
   * Create write stream
   */
  createWriteStream(path, options = {}) {
    this.log("createWriteStream", path, options);
    const normalizedPath = normalize(path);
    return createWriteStream(normalizedPath, options, {
      readFile: (p) => this.readFile(p),
      writeFile: (p, d) => this.writeFile(p, d)
    });
  }
  /**
   * Get file statistics (alias for stat)
   */
  async backFile(path) {
    this.log("backFile", path);
    try {
      return await this.stat(normalize(path));
    } catch (err) {
      if (err.code === "ENOENT") throw err;
      throw createENOENT(path);
    }
  }
  /**
   * Get disk usage for a path
   */
  async du(path) {
    this.log("du", path);
    const normalizedPath = normalize(path);
    const stat = await this.stat(normalizedPath);
    return { path: normalizedPath, size: stat.size };
  }
  /**
   * Get filesystem statistics (similar to Node.js fs.statfs)
   * Uses the Storage API to get quota and usage information
   * Note: Values are estimates for the entire origin, not per-path
   */
  async statfs(path) {
    this.log("statfs", path);
    try {
      if (path) {
        await this.stat(normalize(path));
      }
      if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
        throw new Error("Storage API not available");
      }
      const estimate = await navigator.storage.estimate();
      const usage = estimate.usage ?? 0;
      const quota = estimate.quota ?? 0;
      const bsize = 4096;
      return {
        type: 0,
        bsize,
        blocks: Math.floor(quota / bsize),
        bfree: Math.floor((quota - usage) / bsize),
        bavail: Math.floor((quota - usage) / bsize),
        files: 0,
        ffree: 0,
        usage,
        quota
      };
    } catch (err) {
      this.logError("statfs", err);
      throw wrapError(err);
    }
  }
};

export { constants, OPFS as default };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map