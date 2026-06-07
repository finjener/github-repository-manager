# GitHub Repository Manager

An Obsidian plugin to clone and manage GitHub/GitLab repositories directly within your vault.

## Features

- **Clone repositories** with a single click
- **Update repositories** (fetch & pull) easily
- **Automatic README linking** - links to the repository's README instead of duplicating content
- **Vault Gardener integration** - repositories are excluded from attachment management
- **Consistent folder naming** - uses the same slug pattern as Vault Gardener's `_assets` folders

## Installation

1. Copy this plugin folder to `.obsidian/plugins/github-repository-manager/`
2. Reload Obsidian or enable the plugin in Settings → Community Plugins
3. **Important**: If you use Vault Gardener, ensure repository folders are excluded (see below)

## Usage

### Basic Workflow

1. Create a note for your repository
2. Add the `repo_url` property to the note's frontmatter:
   ```yaml
   ---
   repo_url: https://github.com/user/repo
   ---
   ```
3. Click the **Clone** button (download icon) in the left ribbon
4. Repository will be cloned to `${notename}_repository/` folder next to your note
5. Use the **Update** button (refresh icon) to fetch new changes

### Example Structure

```
My Project/
├── My Project.md                 # Your note
├── My-Project_assets/            # Vault Gardener assets
│   └── screenshot.png
└── My-Project_repository/        # Cloned git repository
    ├── .git/
    ├── README.md
    ├── src/
    └── assets/
```

### Commands

All commands are available via:
- **Ribbon buttons** (primary UI)
- **Command palette** (Ctrl/Cmd + P)

Available commands:
- `Clone repository` - Clone from `repo_url` property
- `Update repository` - Fetch and pull updates
- `Insert README link` - Add link to repository README
- `Open repository in terminal` - Open terminal in repository folder

## Vault Gardener Integration

> [!IMPORTANT]
> **If you use Vault Gardener**, you MUST exclude repository folders to prevent conflicts.

### Required Settings

Open Vault Gardener settings and add the following exclusions:

1. **Excluded Folders**: Add `*/_repository`
2. **Exclude Paths**: Add `**/*_repository/**` to all exclude path settings

Example configuration in `data.json`:
```json
{
  "excludedFolders": "Templates/, */_repository",
  "attachment": {
    "excludePaths": [
      "**/*_assets/**",
      "**/*_repository/**"
    ],
    "excludePathsFromAttachmentCollecting": [
      "**/*_repository/**"
    ],
    "reorganize": {
      "excludePaths": [
        "**/*_repository/**"
      ],
      "excludePathsFromAttachmentCollecting": [
        "**/*_repository/**"
      ]
    }
  }
}
```

The plugin will check your Vault Gardener configuration on load and warn if exclusions are missing.

## Settings

### General
- **Folder suffix**: `_repository` (locked)
- **Property name**: `repo_url` (locked)

### Update Options
- **Dirty working tree behavior**: Choose what happens when repository has uncommitted changes
  - `warn` - Ask user before updating (default)
  - `stash` - Automatically stash changes
  - `skip` - Skip update

### Integration
- **Auto-insert README link**: Automatically insert README link after cloning (default: true)

## FAQ

**Q: Can I use private repositories?**
A: Currently, only public repositories are supported. Private repository support (SSH keys, tokens) is planned for a future release.

**Q: Can I clone with `--depth 1` (shallow clone)?**
A: For now, use manual git commands for shallow clones. This may be added as an option in the future.

**Q: What if I have uncommitted changes?**
A: The plugin detects uncommitted changes and respects your "dirty tree behavior" setting (warn/stash/skip).

**Q: Does this work with GitLab?**
A: Yes! Any git URL works (GitHub, GitLab, Bitbucket, self-hosted, etc.).

## Troubleshooting

**"Git not found" error**
- Install git: `sudo apt install git` (Linux)
- Or: `brew install git` (macOS)
- Or: Download from https://git-scm.com/

**Repository folder exists**
- The plugin will ask if you want to update instead of cloning

**Vault Gardener is moving repository files**
- Check that `**/*_repository/**` is in ALL Vault Gardener exclude paths
- See "Vault Gardener Integration" section above


## License

MIT
