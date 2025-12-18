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
 * Entry for batch file write operation
 */
interface BatchWriteEntry {
    /** File path to write */
    path: string;
    /** Data to write (string or binary) */
    data: string | Uint8Array;
}
/**
 * Result entry for batch file read operation
 */
interface BatchReadResult {
    /** File path */
    path: string;
    /** File data (null if file doesn't exist or error occurred) */
    data: Uint8Array | null;
    /** Error if read failed */
    error?: Error;
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
 * Symlink definition for batch operations
 */
interface SymlinkDefinition {
    target: string;
    path: string;
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

type Backend = 'main' | 'worker';
interface OPFSHybridOptions {
    /** Backend for read operations (default: 'main') */
    read?: Backend;
    /** Backend for write operations (default: 'worker') */
    write?: Backend;
    /** Worker URL (required if using worker backend) */
    workerUrl?: URL | string;
    /** Enable verbose logging */
    verbose?: boolean;
}
/**
 * Hybrid OPFS implementation that routes operations to optimal backends
 */
declare class OPFSHybrid {
    private mainFs;
    private workerFs;
    private readBackend;
    private writeBackend;
    private workerUrl?;
    private workerReady;
    private verbose;
    constructor(options?: OPFSHybridOptions);
    /**
     * Wait for all backends to be ready
     */
    ready(): Promise<void>;
    /**
     * Terminate worker if active
     */
    terminate(): void;
    private getReadFs;
    private getWriteFs;
    readFile(path: string, options?: ReadFileOptions): Promise<Uint8Array | string>;
    readFileBatch(paths: string[]): Promise<BatchReadResult[]>;
    readdir(path: string, options?: ReaddirOptions): Promise<string[] | Dirent[]>;
    stat(path: string): Promise<Stats>;
    lstat(path: string): Promise<Stats>;
    exists(path: string): Promise<boolean>;
    access(path: string, mode?: number): Promise<void>;
    readlink(path: string): Promise<string>;
    realpath(path: string): Promise<string>;
    statfs(path?: string): Promise<StatFs>;
    du(path: string): Promise<DiskUsage>;
    writeFile(path: string, data: string | Uint8Array, options?: WriteFileOptions): Promise<void>;
    writeFileBatch(entries: BatchWriteEntry[]): Promise<void>;
    appendFile(path: string, data: string | Uint8Array, options?: WriteFileOptions): Promise<void>;
    mkdir(path: string): Promise<void>;
    rmdir(path: string): Promise<void>;
    unlink(path: string): Promise<void>;
    truncate(path: string, len?: number): Promise<void>;
    symlink(target: string, path: string): Promise<void>;
    symlinkBatch(symlinks: SymlinkDefinition[]): Promise<void>;
    rename(oldPath: string, newPath: string): Promise<void>;
    copyFile(src: string, dest: string, mode?: number): Promise<void>;
    cp(src: string, dest: string, options?: CpOptions): Promise<void>;
    rm(path: string, options?: RmOptions): Promise<void>;
    chmod(path: string, mode: number): Promise<void>;
    chown(path: string, uid: number, gid: number): Promise<void>;
    utimes(path: string, atime: Date | number, mtime: Date | number): Promise<void>;
    lutimes(path: string, atime: Date | number, mtime: Date | number): Promise<void>;
    mkdtemp(prefix: string): Promise<string>;
    /**
     * Reset internal caches on both backends
     */
    resetCache(): Promise<void>;
    /**
     * Force full garbage collection on both backends
     * More aggressive than resetCache() - reinitializes the worker's OPFS instance
     */
    gc(): Promise<void>;
}

export { type Backend, OPFSHybrid, type OPFSHybridOptions, OPFSHybrid as default };
