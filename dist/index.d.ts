/**
 * File system constants matching Node.js fs.constants
 */
interface FSConstants {
    F_OK: number;
    R_OK: number;
    W_OK: number;
    X_OK: number;
    COPYFILE_EXCL: number;
    COPYFILE_FICLONE: number;
    COPYFILE_FICLONE_FORCE: number;
    O_RDONLY: number;
    O_WRONLY: number;
    O_RDWR: number;
    O_CREAT: number;
    O_EXCL: number;
    O_TRUNC: number;
    O_APPEND: number;
    S_IFMT: number;
    S_IFREG: number;
    S_IFDIR: number;
    S_IFLNK: number;
}
/**
 * Configuration options for OPFS instance
 */
interface OPFSOptions {
    /** Use synchronous access handles when available (default: true) */
    useSync?: boolean;
    /** Enable verbose logging (default: false) */
    verbose?: boolean;
}
/**
 * Options for readFile operation
 */
interface ReadFileOptions {
    /** Text encoding (e.g., 'utf-8'). If not provided, returns Uint8Array */
    encoding?: string;
}
/**
 * Options for writeFile operation
 */
interface WriteFileOptions {
    /** Text encoding for string data */
    encoding?: string;
}
/**
 * Options for readdir operation
 */
interface ReaddirOptions {
    /** Return Dirent objects instead of strings */
    withFileTypes?: boolean;
}
/**
 * Directory entry (Dirent-like object)
 */
interface Dirent {
    name: string;
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
}
/**
 * File statistics
 */
interface Stats {
    type: 'file' | 'dir' | 'symlink';
    size: number;
    mode: number;
    ctime: Date;
    ctimeMs: number;
    mtime: Date;
    mtimeMs: number;
    target?: string;
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
}
/**
 * Options for rm operation
 */
interface RmOptions {
    /** Remove directories and their contents recursively */
    recursive?: boolean;
    /** Ignore if path doesn't exist */
    force?: boolean;
}
/**
 * Options for cp operation
 */
interface CpOptions {
    /** Copy directories recursively */
    recursive?: boolean;
    /** Overwrite existing files */
    force?: boolean;
    /** Throw if destination exists */
    errorOnExist?: boolean;
}
/**
 * Options for watch operation
 */
interface WatchOptions {
    /** Keep the process running while watching (default: true) */
    persistent?: boolean;
    /** Watch subdirectories recursively */
    recursive?: boolean;
    /** Abort signal to stop watching */
    signal?: AbortSignal;
    /** Encoding for filename (default: 'utf8') */
    encoding?: string;
}
/**
 * Watch event
 */
interface WatchEvent {
    eventType: 'rename' | 'change';
    filename: string;
}
/**
 * File watcher
 */
interface FSWatcher {
    close(): void;
    ref(): FSWatcher;
    unref(): FSWatcher;
    [Symbol.asyncIterator](): AsyncIterator<WatchEvent>;
}
/**
 * Read stream options
 */
interface ReadStreamOptions {
    /** Start reading from this byte position */
    start?: number;
    /** Stop reading at this byte position */
    end?: number;
    /** Chunk size for reading (default: 64KB) */
    highWaterMark?: number;
}
/**
 * Write stream options
 */
interface WriteStreamOptions {
    /** File open flags (default: 'w') */
    flags?: string;
    /** Start writing at this byte position */
    start?: number;
}
/**
 * Symlink definition for batch operations
 */
interface SymlinkDefinition {
    target: string;
    path: string;
}
/**
 * Result of read operation on FileHandle
 */
interface ReadResult {
    bytesRead: number;
    buffer: Uint8Array;
}
/**
 * Result of write operation on FileHandle
 */
interface WriteResult {
    bytesWritten: number;
    buffer: Uint8Array;
}
/**
 * FileHandle interface (returned by open())
 */
interface FileHandle {
    fd: number;
    read(buffer: Uint8Array, offset?: number, length?: number, position?: number | null): Promise<ReadResult>;
    write(buffer: Uint8Array, offset?: number, length?: number, position?: number | null): Promise<WriteResult>;
    close(): Promise<void>;
    stat(): Promise<Stats>;
    truncate(len?: number): Promise<void>;
    sync(): Promise<void>;
    datasync(): Promise<void>;
    readFile(options?: ReadFileOptions): Promise<string | Uint8Array>;
    writeFile(data: string | Uint8Array, options?: WriteFileOptions): Promise<void>;
    appendFile(data: string | Uint8Array, options?: WriteFileOptions): Promise<void>;
    [Symbol.asyncDispose](): Promise<void>;
}
/**
 * Directory handle (returned by opendir())
 */
interface Dir {
    path: string;
    read(): Promise<Dirent | null>;
    close(): Promise<void>;
    [Symbol.asyncIterator](): AsyncIterableIterator<Dirent>;
}
/**
 * Disk usage result
 */
interface DiskUsage {
    path: string;
    size: number;
}
/**
 * Filesystem statistics (similar to Node.js fs.statfs)
 */
interface StatFs {
    /** Filesystem type (always 0 for OPFS) */
    type: number;
    /** Optimal transfer block size (simulated as 4096) */
    bsize: number;
    /** Total blocks in filesystem */
    blocks: number;
    /** Free blocks in filesystem */
    bfree: number;
    /** Available blocks for unprivileged users */
    bavail: number;
    /** Total file nodes (0 - not available in browser) */
    files: number;
    /** Free file nodes (0 - not available in browser) */
    ffree: number;
    /** Bytes used by origin (from Storage API) */
    usage: number;
    /** Total bytes available to origin (from Storage API) */
    quota: number;
}
/**
 * Internal symlink cache structure
 */
type SymlinkCache = Record<string, string>;
/**
 * Watch callback function
 */
type WatchCallback = (eventType: string, filename: string) => void;
/**
 * Internal watch registration
 */
interface WatchRegistration {
    path: string;
    callbacks: Set<WatchCallback>;
    recursive: boolean;
}

/**
 * File system constants matching Node.js fs.constants
 */
declare const constants: FSConstants;

/**
 * OPFS-based filesystem implementation compatible with Node.js fs/promises API
 */
declare class OPFS {
    private useSync;
    private verbose;
    private handleManager;
    private symlinkManager;
    private watchCallbacks;
    private tmpCounter;
    /** File system constants */
    readonly constants: FSConstants;
    constructor(options?: OPFSOptions);
    private log;
    private logError;
    /**
     * Execute tasks with limited concurrency to avoid overwhelming the system
     * @param items - Array of items to process
     * @param maxConcurrent - Maximum number of concurrent operations (default: 10)
     * @param taskFn - Function to execute for each item
     */
    private limitConcurrency;
    /**
     * Read file contents
     */
    readFile(path: string, options?: ReadFileOptions): Promise<string | Uint8Array>;
    /**
     * Write data to a file
     */
    writeFile(path: string, data: string | Uint8Array, options?: WriteFileOptions): Promise<void>;
    /**
     * Create a directory
     */
    mkdir(path: string): Promise<void>;
    /**
     * Remove a directory
     */
    rmdir(path: string): Promise<void>;
    /**
     * Remove a file or symlink
     */
    unlink(path: string): Promise<void>;
    /**
     * Read directory contents
     */
    readdir(path: string, options?: ReaddirOptions): Promise<string[] | Dirent[]>;
    /**
     * Get file/directory statistics (follows symlinks)
     */
    stat(path: string): Promise<Stats>;
    /**
     * Get file/directory statistics (does not follow symlinks)
     */
    lstat(path: string): Promise<Stats>;
    /**
     * Rename a file or directory
     */
    rename(oldPath: string, newPath: string): Promise<void>;
    /**
     * Create a symbolic link
     */
    symlink(target: string, path: string): Promise<void>;
    /**
     * Read symlink target
     */
    readlink(path: string): Promise<string>;
    /**
     * Create multiple symlinks efficiently
     */
    symlinkBatch(links: SymlinkDefinition[]): Promise<void>;
    /**
     * Check file accessibility
     */
    access(path: string, mode?: number): Promise<void>;
    /**
     * Append data to a file
     */
    appendFile(path: string, data: string | Uint8Array, options?: WriteFileOptions): Promise<void>;
    /**
     * Copy a file
     */
    copyFile(src: string, dest: string, mode?: number): Promise<void>;
    /**
     * Copy files/directories recursively
     */
    cp(src: string, dest: string, options?: CpOptions): Promise<void>;
    /**
     * Check if path exists
     */
    exists(path: string): Promise<boolean>;
    /**
     * Resolve symlinks to get real path
     */
    realpath(path: string): Promise<string>;
    /**
     * Remove files and directories
     */
    rm(path: string, options?: RmOptions): Promise<void>;
    /**
     * Truncate file to specified length
     */
    truncate(path: string, len?: number): Promise<void>;
    /**
     * Create a unique temporary directory
     */
    mkdtemp(prefix: string): Promise<string>;
    /**
     * Change file mode (no-op for OPFS compatibility)
     */
    chmod(path: string, mode: number): Promise<void>;
    /**
     * Change file owner (no-op for OPFS compatibility)
     */
    chown(path: string, uid: number, gid: number): Promise<void>;
    /**
     * Update file timestamps (no-op for OPFS compatibility)
     */
    utimes(path: string, atime: Date | number, mtime: Date | number): Promise<void>;
    /**
     * Update symlink timestamps (no-op)
     */
    lutimes(path: string, atime: Date | number, mtime: Date | number): Promise<void>;
    /**
     * Open file and return FileHandle
     */
    open(path: string, flags?: string | number, mode?: number): Promise<FileHandle>;
    /**
     * Open directory for iteration
     */
    opendir(path: string): Promise<Dir>;
    /**
     * Watch for file changes
     */
    watch(path: string, options?: WatchOptions): FSWatcher;
    /**
     * Create read stream
     */
    createReadStream(path: string, options?: ReadStreamOptions): ReadableStream<Uint8Array>;
    /**
     * Create write stream
     */
    createWriteStream(path: string, options?: WriteStreamOptions): WritableStream<Uint8Array>;
    /**
     * Get file statistics (alias for stat)
     */
    backFile(path: string): Promise<Stats>;
    /**
     * Get disk usage for a path
     */
    du(path: string): Promise<DiskUsage>;
    /**
     * Get filesystem statistics (similar to Node.js fs.statfs)
     * Uses the Storage API to get quota and usage information
     * Note: Values are estimates for the entire origin, not per-path
     */
    statfs(path?: string): Promise<StatFs>;
}

export { type CpOptions, type Dir, type Dirent, type DiskUsage, type FSConstants, type FSWatcher, type FileHandle, type OPFSOptions, type ReadFileOptions, type ReadResult, type ReadStreamOptions, type ReaddirOptions, type RmOptions, type StatFs, type Stats, type SymlinkCache, type SymlinkDefinition, type WatchCallback, type WatchEvent, type WatchOptions, type WatchRegistration, type WriteFileOptions, type WriteResult, type WriteStreamOptions, constants, OPFS as default };
