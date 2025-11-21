import { describe, it, expect, beforeEach } from 'vitest'
import git from 'isomorphic-git'
import OPFS from '../index.js'

describe('Git Integration Tests', () => {
  let fs

  beforeEach(() => {
    resetFileSystem()
    fs = new OPFS({ useSync: true, verbose: false })
  })

  describe('Basic Git Operations', () => {
    it('should initialize a git repository', async () => {
      await git.init({ fs, dir: '/test-repo' })

      const files = await fs.readdir('/test-repo')
      expect(files).toContain('.git')
    })

    it('should create commits', async () => {
      await git.init({ fs, dir: '/repo' })

      await fs.writeFile('/repo/test.txt', 'Hello World')
      await git.add({ fs, dir: '/repo', filepath: 'test.txt' })

      const sha = await git.commit({
        fs,
        dir: '/repo',
        message: 'Initial commit',
        author: {
          name: 'Test User',
          email: 'test@example.com'
        }
      })

      expect(sha).toBeTruthy()
      expect(sha).toHaveLength(40)
    })

    it('should read git status', async () => {
      await git.init({ fs, dir: '/repo' })

      await fs.writeFile('/repo/file.txt', 'content')

      const status = await git.status({
        fs,
        dir: '/repo',
        filepath: 'file.txt'
      })

      expect(status).toBeDefined()
    })
  })

  describe('Symlink Handling in Git', () => {
    it('should create and commit a symlink', async () => {
      await git.init({ fs, dir: '/repo' })

      // Create a target file
      await fs.writeFile('/repo/target.txt', 'target content')
      await git.add({ fs, dir: '/repo', filepath: 'target.txt' })

      // Create a symlink
      await fs.symlink('/repo/target.txt', '/repo/link.txt')
      await git.add({ fs, dir: '/repo', filepath: 'link.txt' })

      // Commit
      const sha = await git.commit({
        fs,
        dir: '/repo',
        message: 'Add symlink',
        author: {
          name: 'Test User',
          email: 'test@example.com'
        }
      })

      expect(sha).toBeTruthy()

      // Verify symlink exists
      const lstat = await fs.lstat('/repo/link.txt')
      expect(lstat.isSymbolicLink()).toBe(true)
    })

    it('should handle symlink in readTree', async () => {
      await git.init({ fs, dir: '/repo' })

      // Create target and symlink
      await fs.writeFile('/repo/target.txt', 'content')
      await fs.symlink('/repo/target.txt', '/repo/link.txt')

      await git.add({ fs, dir: '/repo', filepath: 'target.txt' })
      await git.add({ fs, dir: '/repo', filepath: 'link.txt' })

      const sha = await git.commit({
        fs,
        dir: '/repo',
        message: 'Add files',
        author: { name: 'Test', email: 'test@example.com' }
      })

      // Read tree using commit SHA
      const tree = await git.readTree({
        fs,
        dir: '/repo',
        oid: sha
      })

      expect(tree.tree).toBeDefined()
      expect(Array.isArray(tree.tree)).toBe(true)
    })
  })

  describe('Simulate Clone-like Operations with Symlinks', () => {
    it('should handle creating many files and symlinks like a clone operation', async () => {
      await git.init({ fs, dir: '/clone-sim' })

      // Simulate a repository structure with mixed files and symlinks
      // This mimics what happens during a real git clone
      await fs.mkdir('/clone-sim/src')
      await fs.mkdir('/clone-sim/lib')
      await fs.mkdir('/clone-sim/docs')

      // Create regular files
      await fs.writeFile('/clone-sim/README.md', '# Test Repo')
      await fs.writeFile('/clone-sim/package.json', '{"name":"test"}')
      await fs.writeFile('/clone-sim/src/index.js', 'export default {}')
      await fs.writeFile('/clone-sim/src/utils.js', 'export const util = 1')
      await fs.writeFile('/clone-sim/lib/main.js', 'import * as src from "../src/index.js"')

      // Create symlinks (common in repos for aliases/shortcuts)
      await fs.symlink('/clone-sim/README.md', '/clone-sim/docs/README.md')
      await fs.symlink('/clone-sim/src/index.js', '/clone-sim/lib/index.js')
      await fs.symlink('/clone-sim/package.json', '/clone-sim/docs/package.json')

      // Add all files to git
      await git.add({ fs, dir: '/clone-sim', filepath: 'README.md' })
      await git.add({ fs, dir: '/clone-sim', filepath: 'package.json' })
      await git.add({ fs, dir: '/clone-sim', filepath: 'src/index.js' })
      await git.add({ fs, dir: '/clone-sim', filepath: 'src/utils.js' })
      await git.add({ fs, dir: '/clone-sim', filepath: 'lib/main.js' })
      await git.add({ fs, dir: '/clone-sim', filepath: 'docs/README.md' })
      await git.add({ fs, dir: '/clone-sim', filepath: 'lib/index.js' })
      await git.add({ fs, dir: '/clone-sim', filepath: 'docs/package.json' })

      // Commit everything
      const sha = await git.commit({
        fs,
        dir: '/clone-sim',
        message: 'Initial commit with symlinks',
        author: { name: 'Test', email: 'test@example.com' }
      })

      expect(sha).toBeTruthy()

      // Verify all symlinks still work
      const readmeContent = await fs.readFile('/clone-sim/docs/README.md', { encoding: 'utf-8' })
      expect(readmeContent).toBe('# Test Repo')

      const indexContent = await fs.readFile('/clone-sim/lib/index.js', { encoding: 'utf-8' })
      expect(indexContent).toBe('export default {}')

      // Verify directory listing shows all files
      const rootFiles = await fs.readdir('/clone-sim')
      expect(rootFiles).toContain('README.md')
      expect(rootFiles).toContain('package.json')
      expect(rootFiles).toContain('src')
      expect(rootFiles).toContain('lib')
      expect(rootFiles).toContain('docs')
    })

    it('should handle symlinks in subdirectories during checkout-like operations', async () => {
      await git.init({ fs, dir: '/checkout-test' })

      // Create nested structure with symlinks
      await fs.mkdir('/checkout-test/deep/nested/path')
      await fs.writeFile('/checkout-test/deep/nested/path/file.txt', 'deep content')
      await fs.symlink('/checkout-test/deep/nested/path/file.txt', '/checkout-test/link-to-deep.txt')

      // Add and commit
      await git.add({ fs, dir: '/checkout-test', filepath: 'deep/nested/path/file.txt' })
      await git.add({ fs, dir: '/checkout-test', filepath: 'link-to-deep.txt' })

      const sha = await git.commit({
        fs,
        dir: '/checkout-test',
        message: 'Add deep symlink',
        author: { name: 'Test', email: 'test@example.com' }
      })

      expect(sha).toBeTruthy()

      // Verify symlink resolution works through deep paths
      const content = await fs.readFile('/checkout-test/link-to-deep.txt', { encoding: 'utf-8' })
      expect(content).toBe('deep content')

      // Verify lstat shows it's a symlink
      const lstat = await fs.lstat('/checkout-test/link-to-deep.txt')
      expect(lstat.isSymbolicLink()).toBe(true)
      expect(lstat.target).toBe('/checkout-test/deep/nested/path/file.txt')
    })
  })

  describe('Git Checkout with Symlinks', () => {
    it('should persist symlinks after commit', async () => {
      await git.init({ fs, dir: '/repo' })

      // Create and commit a file with symlink
      await fs.writeFile('/repo/file.txt', 'version 1')
      await fs.symlink('/repo/file.txt', '/repo/link.txt')

      await git.add({ fs, dir: '/repo', filepath: 'file.txt' })
      await git.add({ fs, dir: '/repo', filepath: 'link.txt' })

      await git.commit({
        fs,
        dir: '/repo',
        message: 'Add file and symlink',
        author: { name: 'Test', email: 'test@example.com' }
      })

      // Verify symlink still exists after commit
      const lstat = await fs.lstat('/repo/link.txt')
      expect(lstat.isSymbolicLink()).toBe(true)

      // Verify can read through symlink
      const content = await fs.readFile('/repo/link.txt', { encoding: 'utf-8' })
      expect(content).toBe('version 1')
    })
  })

  describe('Edge Cases with Git and Symlinks', () => {
    it('should handle symlink chain in git repo', async () => {
      await git.init({ fs, dir: '/repo' })

      await fs.writeFile('/repo/target.txt', 'data')
      await fs.symlink('/repo/target.txt', '/repo/link1.txt')
      await fs.symlink('/repo/link1.txt', '/repo/link2.txt')

      await git.add({ fs, dir: '/repo', filepath: 'target.txt' })
      await git.add({ fs, dir: '/repo', filepath: 'link1.txt' })
      await git.add({ fs, dir: '/repo', filepath: 'link2.txt' })

      const sha = await git.commit({
        fs,
        dir: '/repo',
        message: 'Add symlink chain',
        author: { name: 'Test', email: 'test@example.com' }
      })

      expect(sha).toBeTruthy()
    })

    it('should handle broken symlink in git repo', async () => {
      await git.init({ fs, dir: '/repo' })

      // Create symlink pointing to non-existent file
      await fs.symlink('/repo/nonexistent.txt', '/repo/broken-link.txt')
      await git.add({ fs, dir: '/repo', filepath: 'broken-link.txt' })

      const sha = await git.commit({
        fs,
        dir: '/repo',
        message: 'Add broken symlink',
        author: { name: 'Test', email: 'test@example.com' }
      })

      expect(sha).toBeTruthy()

      // Verify broken symlink can be lstated
      const lstat = await fs.lstat('/repo/broken-link.txt')
      expect(lstat.isSymbolicLink()).toBe(true)

      // But stat should fail
      await expect(
        fs.stat('/repo/broken-link.txt')
      ).rejects.toMatchObject({ code: 'ENOENT' })
    })

    it('should handle directory with symlinks in git operations', async () => {
      await git.init({ fs, dir: '/repo' })

      await fs.mkdir('/repo/subdir')
      await fs.writeFile('/repo/subdir/file.txt', 'content')
      await fs.symlink('/repo/subdir/file.txt', '/repo/subdir/link.txt')

      await git.add({ fs, dir: '/repo', filepath: 'subdir/file.txt' })
      await git.add({ fs, dir: '/repo', filepath: 'subdir/link.txt' })

      const sha = await git.commit({
        fs,
        dir: '/repo',
        message: 'Add subdir with symlink',
        author: { name: 'Test', email: 'test@example.com' }
      })

      expect(sha).toBeTruthy()

      // List directory
      const entries = await fs.readdir('/repo/subdir', { withFileTypes: true })
      const symlink = entries.find(e => e.name === 'link.txt')
      expect(symlink).toBeDefined()
      expect(symlink.isSymbolicLink()).toBe(true)
    })
  })

  describe('Performance with Git Operations', () => {
    it('should handle multiple file operations efficiently', async () => {
      await git.init({ fs, dir: '/repo' })

      const start = performance.now()

      // Create 50 files
      for (let i = 0; i < 50; i++) {
        await fs.writeFile(`/repo/file${i}.txt`, `content ${i}`)
        await git.add({ fs, dir: '/repo', filepath: `file${i}.txt` })
      }

      await git.commit({
        fs,
        dir: '/repo',
        message: 'Add 50 files',
        author: { name: 'Test', email: 'test@example.com' }
      })

      const duration = performance.now() - start
      console.log(`50 files + commit: ${duration.toFixed(2)}ms`)

      expect(duration).toBeLessThan(10000) // Should complete in 10 seconds
    })

    it('should handle multiple symlinks efficiently', async () => {
      await git.init({ fs, dir: '/repo' })

      // Create targets
      for (let i = 0; i < 20; i++) {
        await fs.writeFile(`/repo/target${i}.txt`, `data ${i}`)
      }

      const start = performance.now()

      // Create symlinks using batch operation
      const links = []
      for (let i = 0; i < 20; i++) {
        links.push({
          target: `/repo/target${i}.txt`,
          path: `/repo/link${i}.txt`
        })
      }
      await fs.symlinkBatch(links)

      const duration = performance.now() - start
      console.log(`20 symlinks (batch): ${duration.toFixed(2)}ms`)

      expect(duration).toBeLessThan(1000)
    })
  })
})
