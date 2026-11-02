# Project review — 2026-11-02

Reviewed commit: `2fdc59c` (`Apply the library, tag picker, and focus designs (#3)`).

The highest priorities are protecting unsaved edits and metadata, fixing Windows resource loading, and removing synchronous preview rendering from the typing path. This review documents 14 findings and several smaller improvements. Application source was not changed.

P1 means a high-priority data integrity, platform availability, or responsiveness issue. P2 means a significant correctness or scaling issue. “Reproduced” identifies an executed probe; “code inspection” identifies a conclusion without a complete platform or UI reproduction.

## Validation and limits

Review environment: macOS arm64, Node.js `22.22.0`, installed project dependencies.

| Check                                 | Result                                                                                                                                                                                                |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                            | Passed: 25 tests in 6 files.                                                                                                                                                                          |
| `npm run typecheck`                   | Passed.                                                                                                                                                                                               |
| `npm run lint`                        | Passed, including the final report formatting.                                                                                                                                                        |
| `npm run package`                     | Main, preload, and renderer production bundles built. Packaging subsequently failed with `fetch failed` while downloading Electron; installer/package completion was not verified.                    |
| `npm run test:e2e -- --timeout=25000` | Outside the sandbox, 6 of 8 cases passed. The two quit cases failed on macOS; see the testing improvements below. The initial sandboxed attempt could not launch Electron.                            |
| Temporary core probes                 | 10 passed, checking seven defect scenarios and three groups of performance measurements. These assert the observed defects, not their correction.                                                     |
| Temporary Electron probes             | Reproduced the save race, canceled-navigation dirty-state loss, lost undo history, cross-folder snippet contamination, and the toolbar target ambiguity. Used temporary notes and isolated user data. |

Windows and Linux runtimes were not exercised in this review. The Windows finding below uses the real request-guard function with a mocked Windows app path. Performance numbers are local synthetic measurements, not production latency guarantees. Test-generated documentation screenshots were restored.

## Findings

### 1. [P1] Save completion marks newer, unwritten edits as saved

**Location:** [src/ui/App.tsx](../src/ui/App.tsx), lines 259–267.

`save()` sends the current buffer to `writeFile`, awaits the IPC response, and then takes a fresh value from `bufferRef.current` as the saved baseline. If the user types during that wait, the newer text was never written, but the status becomes “Saved.” Leaving the file then skips the unsaved-changes prompt.

**Reproduced:** delayed the response from the real write handler after it saved the submitted text, typed `NEW UNSAVED TEXT`, and released the response. The editor contained the new text, the disk file did not, and the dirty indicator disappeared. The delay was injected to make the race deterministic; no production delay threshold was measured.

**Suggested fix:** capture the document/session identity and submitted content before awaiting. Only update that document's saved baseline to the captured content. Serialize or version overlapping saves so an older response cannot overwrite newer save state.

**Regression check:** type during a delayed save and verify that the newer buffer remains dirty; also change documents while a save is pending.

### 2. [P1] Canceling navigation after Discard leaves an unsaved buffer marked clean

**Location:** [src/ui/App.tsx](../src/ui/App.tsx), lines 291–298, 324–355.

`ensureCanLeave()` changes the saved baseline immediately when the user selects Discard. The subsequent operation can still be canceled or fail, leaving the original buffer open and incorrectly marked as saved. This affects New File, a canceled folder picker, and failed file navigation.

**Reproduced:** edit a file → New document → Discard → Cancel the New file dialog. The draft remains visible, its disk file is unchanged, and “Unsaved” disappears. Opening another document then loses the draft without another prompt.

**Suggested fix:** treat Discard as authorization for the pending transition. Keep the original buffer and saved baseline intact until the transition actually succeeds, or explicitly restore the disk content if discarding immediately is intended.

**Regression check:** cover cancellation of both the file-name prompt and folder picker, plus a destination read/create failure.

### 3. [P1] A temporarily incomplete scan permanently deletes tags and favorites

**Location:** [src/core/tree.ts](../src/core/tree.ts), lines 59–62 and 104–110; [src/main/library.ts](../src/main/library.ts), lines 234–248; [src/core/tags.ts](../src/core/tags.ts), lines 229–254.

The scanner silently skips unreadable directories and files. It returns the partial result as if it were a complete snapshot. `refresh()` then reconciles and persists the index against that snapshot, dropping metadata for files that merely could not be read. Retrying the scan does not restore the deleted metadata.

**Reproduced:** tag and favorite `sub/a.md`, inject one `EIO` failure for `readdirSync(sub)`, reconcile, restore successful reads, and reconcile again. The file still exists, but both its tag and favorite are gone.

**Suggested fix:** report scan completeness and failed paths. Preserve metadata in uncertain subtrees; only infer deletion from a successful authoritative scan. Distinguish read errors from confirmed disappearance in open-file polling as well.

**Regression check:** a one-time directory or stat failure must not alter persisted metadata, while a confirmed deletion should retain the documented cleanup behavior.

### 4. [P1] The production request guard rejects normal Windows file URLs

**Location:** [src/main/security.ts](../src/main/security.ts), lines 14–28.

`allowedRequest()` compares a decoded `file:` URL directly with the filesystem string returned by `app.getAppPath()`. Windows file URLs use forward slashes, while native Windows paths normally use backslashes. The substring check therefore rejects legitimate packaged resources, including the renderer document.

**Reproduced at the function boundary:** with app path `C:\Users\test\AppData\Local\Simple MD\resources\app.asar`, the guard returned `{ cancel: true }` for the corresponding `file:///C:/Users/test/AppData/Local/Simple%20MD/resources/app.asar/.vite/renderer/main_window/index.html` request. A full Windows launch remains unverified.

**Suggested fix:** parse the URL with `fileURLToPath` and compare normalized filesystem paths with proper containment checks. Replace substring trust checks with exact origins/paths where applicable.

**Regression check:** packaged startup on Windows, paths with spaces, and rejection of sibling paths that merely contain the app-path text.

### 5. [P1] Renaming or trashing a symlink operates on its target

**Location:** [src/core/files.ts](../src/core/files.ts), lines 101–130; [src/core/paths.ts](../src/core/paths.ts), lines 92–96; [src/main/library.ts](../src/main/library.ts), lines 160–165.

Reading through an internal symlink is intentional, but rename and trash reuse the same target-resolving function. Selecting an alias can therefore rename or trash the real document or directory, leaving the alias dangling. A directory alias makes the potential impact larger than the selected link itself.

**Reproduced:** create `alias.md -> real.md` and rename `alias.md` to `renamed.md`. `real.md` disappears, `renamed.md` contains its content, and `alias.md` remains as a dangling symlink. `describePath(alias.md).abs` also resolves to `real.md`, which is the path passed to the trash API; actual OS trash was not invoked by this probe.

**Suggested fix:** separate content resolution from entry mutation. Validate containment through the parent chain, but rename/trash the selected final directory entry, or make target operations an explicit, clearly labeled choice. Keep protection against paths escaping the library.

**Regression check:** file and directory symlinks, including links to directories containing multiple documents; real targets must survive an alias-only operation.

### 6. [P1, performance] Full synchronous Markdown rendering runs even in Write and Focus modes

**Location:** [src/ui/App.tsx](../src/ui/App.tsx), lines 189–192 and 555–558; [src/core/markdown.ts](../src/core/markdown.ts), lines 61–71.

Every buffer update schedules a full parse after 40 ms, regardless of whether a preview is visible. `renderMarkdown()` constructs the processor/highlighter and runs `processSync()` on the renderer thread. Debouncing postpones this work; it does not make the work nonblocking. Opening a document also renders it immediately through `commitFile()`.

**Measured:** a synthetic 100 KB document took 406–488 ms per render; a 500 KB document took 4,274–5,366 ms. Both are far below the allowed 8 MB file size. These are direct function timings; the code path establishes that the same synchronous work runs in the UI thread, including when the preview is hidden.

**Suggested fix:** first stop rendering when no preview is visible. Reuse the configured processor. For larger documents, render off the UI thread, discard obsolete results, and apply a deliberate large-document policy. A longer debounce alone will not resolve multi-second stalls.

**Regression check:** assert that Write/Focus editing does not invoke preview rendering; measure input responsiveness during edits to representative large prose, table, and fenced-code documents.

### 7. [P2] Saving before the next external-change poll silently overwrites disk edits

**Location:** [src/main/library.ts](../src/main/library.ts), lines 114–134 and 273–290; [src/shared/schemas.ts](../src/shared/schemas.ts), lines 22–25.

Writes contain only a path and content, with no expected disk revision. An external edit between the last read/poll and Save is overwritten unconditionally. Saving also resets the polling baseline to the new content, so the lost external change is never reported afterward.

**Reproduced:** read a file through `Library`, modify it externally, call `Library.write()` before polling, then poll. The local content replaced the external content and no conflict event was emitted.

**Suggested fix:** pass an expected disk revision with each save and check for conflicts immediately before replacement. Make overwriting a detected conflict explicit. Document the remaining concurrent-writer race if the filesystem operation cannot guarantee a compare-and-swap.

**Regression check:** save immediately after an external edit, replacement, or deletion without waiting for the polling interval.

### 8. [P2] Atomic saves discard restrictive file permissions

**Location:** [src/core/atomic.ts](../src/core/atomic.ts), lines 4–8; [src/core/files.ts](../src/core/files.ts), lines 61–68.

Saving creates a new temporary file with default permissions and renames it over the original. The original mode is not preserved, so editing a private document can broaden access to its contents.

**Reproduced on macOS:** a `0600` Markdown file became `0644` after saving under umask `0022`. This is a verified POSIX-mode change; ACL and extended-attribute behavior was not tested.

**Suggested fix:** preserve the original file's permission mode when replacing it, create temporary files restrictively, and decide explicitly which other metadata must survive a save. Use unique, exclusively created temporary files and clean them up on failure.

**Regression check:** saving a `0600` file must preserve `0600`; separately exercise failures during temporary-file creation and rename.

### 9. [P2] A successful Unicode save can create a file the app refuses to reopen

**Location:** [src/core/files.ts](../src/core/files.ts), lines 37 and 61–67; [src/shared/schemas.ts](../src/shared/schemas.ts), lines 22–25.

The write limit uses JavaScript string length, while the read limit uses file bytes. Non-ASCII content can pass the write and IPC checks but exceed the 8,000,000-byte read limit once UTF-8 encoded.

**Reproduced:** saving `"é".repeat(4_000_001)` succeeded and produced 8,000,002 bytes. Reading that same file then threw `File is too large`. Open-file polling also treats this read error as disappearance.

**Suggested fix:** enforce `Buffer.byteLength(content, "utf8")` in the main-process write boundary before modifying the file, and provide a consistent user-facing limit.

**Regression check:** round-trip ASCII, accented text, CJK, and emoji immediately below and above the byte limit; rejected writes must preserve the original file.

### 10. [P2] Retrying a failed index write can report success without persisting metadata

**Location:** [src/core/tags.ts](../src/core/tags.ts), lines 275–285.

`TagIndex.save()` assigns `savedText` before `writeAtomic()` succeeds. If the write fails, the in-memory index already contains the mutation and its cache claims that text was persisted. Retrying the same mutation hits the equality check and skips the disk write.

**Reproduced:** inject one rename failure while assigning tag `keep`, then retry the same assignment. The retry returns `['keep']`, but reopening the index from disk returns no tags.

**Suggested fix:** update `savedText` only after a successful write. Keep failed mutations explicitly pending or restore the previous in-memory state so the caller sees a consistent result.

**Regression check:** fail the first write, retry an identical tag/favorite mutation, reopen the index, and verify persistence.

### 11. [P2] Switching to Preview destroys undo history

**Location:** [src/ui/EditorPane.tsx](../src/ui/EditorPane.tsx), lines 407–419; [src/ui/Editor.tsx](../src/ui/Editor.tsx), lines 255–294.

Preview mode unmounts `Editor`, which destroys the CodeMirror view. Returning to Write creates a new `EditorState` and history extension from the current text, losing undo/redo history and editor selection state for the same document. A rename also recreates the view because its effect depends on the path.

**Reproduced in Electron:** type text, switch to Preview, return to Write, and press Cmd+Z. The edit remains; there is no history to undo.

**Suggested fix:** preserve the document's `EditorState` across presentation-mode changes, or keep the editor mounted while hiding it. Treat a rename as a document identity change only where necessary.

**Regression check:** undo/redo and cursor position must survive Write → Preview → Write, Focus transitions, and an in-app rename.

### 12. [P2] Snippet caching crosses library boundaries and never evicts old versions

**Location:** [src/ui/DocColumn.tsx](../src/ui/DocColumn.tsx), lines 47 and 77–97; [src/ui/App.tsx](../src/ui/App.tsx), lines 661–694.

The cache key is only `path:mtimeMs`; the component survives library switches. Different folders containing the same relative path and timestamp can display each other's text. Such timestamps are plausible in copied or restored note trees. The map also retains every visited file version for the window's lifetime, and canceled requests still populate it.

**Reproduced in Electron:** open `Alpha/shared.md`, switch to a Beta library whose `shared.md` has different text but the same timestamp. The Beta document card displays `Snippet from Alpha`. The unbounded-memory consequence is based on code inspection, not a long-duration memory profile.

**Suggested fix:** scope keys and in-flight requests to a library/session identity. Reset on library changes, replace stale versions, and use a bounded cache if browsing very large libraries is supported. Prevent results from an old session from repopulating the new cache.

**Regression check:** two libraries with identical relative paths/timestamps, an in-flight snippet response during switching, and repeated edits to the same file.

### 13. [P2, performance] Idle polling repeatedly reads entire documents and rescans the library

**Location:** [src/main/library.ts](../src/main/library.ts), lines 84–90 and 234–290; [src/core/tree.ts](../src/core/tree.ts), lines 35–39, 59–60, and 104–114.

Every second, the open document is synchronously read and hashed even when unchanged. Every fourth tick, the entire library is rescanned, sorted, and serialized to detect changes. `scanRoot()` yields every 200 entries, which helps, but its filesystem operations still run synchronously on Electron's main thread. Polling also continues after the macOS window closes because the library is only closed when the app quits or switches libraries.

**Measured:** scanning 10,000 small Markdown files took 193–267 ms wall time and 219–225 ms process CPU per scan on a local filesystem. Ten unchanged polls of a 7.9 MB file each performed a full read and took 7–14 ms apiece. The latter represents about 7.9 MB/s of logical reads and repeated string/hash allocation at the configured interval, even if the OS serves the bytes from cache. Network-storage latency and battery impact were not measured.

**Suggested fix:** use filesystem change notifications with a bounded reconciliation fallback; compare file identity/mtime/size before rereading content, while retaining safeguards for metadata-preserving edits. Move expensive filesystem work off the main event loop and reduce or suspend unnecessary work with no window open.

**Regression check:** an unchanged library should perform near-zero content reads between fallback checks. Measure main-thread responsiveness and CPU for large libraries, external replacements, and slow/unavailable storage.

### 14. [P2, performance] Bulk rename reconciliation performs quadratic synchronous work

**Location:** [src/core/tags.ts](../src/core/tags.ts), lines 229–254.

For every indexed path missing from the scan, reconciliation filters the remaining unclaimed files by device/inode and then searches/splices that array. An external directory rename affecting many tagged documents therefore approaches quadratic work, on the main thread, before synchronously rewriting the index.

**Measured:** reconciling synthetic same-volume directory renames for 1,000, 5,000, and 10,000 tagged files took approximately 12, 169, and 334 ms respectively. These timings include index persistence; the nested scans establish the scaling concern independently of the exact timings.

**Suggested fix:** build a device/inode lookup once, preserving the current requirement that a match be unambiguous. Consume matches without repeatedly filtering/splicing the full array, and persist the final result once.

**Regression check:** bulk external renames at increasing library sizes, duplicate inode identities/hard links, and preservation of tag/favorite assignments.

## Performance measurement details

The rendering probe called the actual `renderMarkdown()` after one small warm-up. It repeated and truncated the following ASCII sample to the requested byte size, then made three measurements at each size:

````markdown
# Heading

Paragraph with **bold** and a [link](a.md).

- item one
- item two

```js
const value = 42;
```
````

| Operation             | Input                               | Observed time                   |
| --------------------- | ----------------------------------- | ------------------------------- |
| Markdown rendering    | 10,000 bytes                        | 77 / 38 / 36 ms                 |
| Markdown rendering    | 100,000 bytes                       | 406 / 424 / 488 ms              |
| Markdown rendering    | 500,000 bytes                       | 5,181 / 4,274 / 5,366 ms        |
| Library scan          | 10,000 files containing `# Note\n`  | 193 / 262 / 267 ms wall time    |
| Unchanged-file poll   | 7,900,000 ASCII bytes, 10 calls     | 7–14 ms per call; 10 full reads |
| Rename reconciliation | 1,000 / 5,000 / 10,000 tagged files | 12 / 169 / 334 ms               |

These tests used temporary local files. They did not measure complete UI interaction latency, sustained memory use, cold physical-disk throughput, or network shares. The temporary probes were separate from the committed test suite.

## Further improvements worth testing

These are narrower opportunities or inspection-based risks, not additional measured regressions:

- **Cache and bound image loading.** [Preview.tsx](../src/ui/Preview.tsx), lines 22–36, requests every local image again whenever the HTML changes, without deduplicating identical image references. [files.ts](../src/core/files.ts), lines 134–145, reads and base64-encodes each image synchronously, then transfers it over IPC. Repeated images in split view can multiply reads and allocations on every edit. Cache by library/path/revision, deduplicate requests, and bound concurrent loading. Verify read counts while editing an image-heavy document.
- **Reduce typing work outside the editor.** [Editor.tsx](../src/ui/Editor.tsx), lines 282–283, converts the whole document to a string on each change; [App.tsx](../src/ui/App.tsx), lines 200–201 and 619–621, recounts words and scans the catalog, while [Sidebar.tsx](../src/ui/Sidebar.tsx) rebuilds the folder-only tree during rendering. Profile these costs after fixing preview rendering, then isolate editor state and memoize stable library-derived work where measurements justify it.
- **Clip line decorations to the viewport.** [Editor.tsx](../src/ui/Editor.tsx), lines 145–154, visits visible syntax ranges but decorates every line in an intersecting fenced-code or blockquote node. A very large block can still require work proportional to the whole block on scrolling. Restrict decoration construction to the visible line intersection and test a long fenced block.
- **Make the toolbar's target explicit.** After opening `a.md` and selecting folder `sub`, the editor toolbar still shows `a.md`, but Rename/Move to trash use `selected` and target `sub`; Favorite/Reveal/Copy path use the open file. This behavior was reproduced through the confirmation dialog without trashing anything. The dialog does name the folder, so this is an interaction-design concern rather than evidence of an unconfirmed deletion. Separate folder actions or display their target in the menu.
- **Exercise actual platform behavior in CI.** The existing quit tests call `getMenuItemById("quit")`; [main.ts](../src/main.ts), lines 110–114, only assigns that ID outside macOS, whose Quit item comes from the app-menu role. In this review the clean quit test reported `Missing menu item quit`; the dirty quit test timed out. Select native menu roles portably and ensure teardown cannot wait indefinitely on an unsaved-changes prompt. CI currently runs E2E only on Linux, leaving the Windows request-guard issue undetected. Add at least a packaged-resource/startup smoke test on each supported platform.

## Suggested implementation order

1. Protect save/discard state and metadata persistence: findings 1–3, 7, and 10.
2. Correct Windows loading, symlink mutations, permission preservation, and byte-limit consistency: findings 4–5 and 8–9.
3. Remove hidden synchronous preview work, then reduce background scans and reconciliation costs: findings 6 and 13–14.
4. Preserve editor history and scope caches correctly: findings 11–12; follow with the focused profiling and platform-test improvements above.
