const { Plugin, Notice, PluginSettingTab, Setting, Modal } = require("obsidian");
const { exec } = require("child_process");
const { promisify } = require("util");
const execAsync = promisify(exec);

const DEFAULT_SETTINGS = {
    folderSuffix: "_repository",
    propertyName: "repo_url",
    autoInsertReadmeLink: true,
    dirtyTreeBehavior: "warn" // "warn", "stash", "skip"
};

module.exports = class GitHubRepositoryManagerPlugin extends Plugin {
    async onload() {
        console.log("GitHub Repository Manager loading...");
        await this.loadSettings();

        // Check Vault Gardener integration
        await this.checkVaultGardenerIntegration();

        // Add ribbon icon for Clone
        this.addRibbonIcon("download", "Clone repository", async () => {
            await this.cloneRepository();
        });

        // Add ribbon icon for Update
        this.addRibbonIcon("refresh-cw", "Update repository", async () => {
            await this.updateRepository();
        });

        // Add commands
        this.addCommand({
            id: "clone-repository",
            name: "Clone repository",
            callback: async () => {
                await this.cloneRepository();
            }
        });

        this.addCommand({
            id: "update-repository",
            name: "Update repository",
            callback: async () => {
                await this.updateRepository();
            }
        });

        this.addCommand({
            id: "insert-readme-link",
            name: "Insert README link",
            callback: async () => {
                await this.insertReadmeLink();
            }
        });

        this.addCommand({
            id: "open-in-terminal",
            name: "Open repository in terminal",
            callback: async () => {
                await this.openInTerminal();
            }
        });

        // Add settings tab
        this.addSettingTab(new GitHubRepositoryManagerSettingTab(this.app, this));

        console.log("GitHub Repository Manager loaded successfully");
    }

    onunload() {
        console.log("GitHub Repository Manager unloaded");
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    /**
     * Check if Vault Gardener is properly configured to exclude repository folders
     */
    async checkVaultGardenerIntegration() {
        const vgPlugin = this.app.plugins.plugins['vault-gardener'];
        if (!vgPlugin) {
            return; // Vault Gardener not installed
        }

        const settings = vgPlugin.settings;
        const warnings = [];

        // Check excludedFolders
        if (!settings.excludedFolders?.includes('_repository')) {
            warnings.push('Add "*/_repository" to Vault Gardener excluded folders');
        }

        // Check attachment.excludePaths
        if (!settings.attachment?.excludePaths?.some(p => p.includes('_repository'))) {
            warnings.push('Add "**/*_repository/**" to Vault Gardener exclude paths');
        }

        if (warnings.length > 0) {
            new Notice('⚠️ Vault Gardener integration check:\n' + warnings.join('\n'), 10000);
        }
    }

    /**
     * Copy slugify function from Vault Gardener for consistency
     */
    transliterate(n) {
        if (!n) return "";
        n = n
            .replace(/Ğ/g, "G")
            .replace(/ğ/g, "g")
            .replace(/Ü/g, "U")
            .replace(/ü/g, "u")
            .replace(/Ş/g, "S")
            .replace(/ş/g, "s")
            .replace(/İ/g, "I")
            .replace(/ı/g, "i")
            .replace(/Ö/g, "O")
            .replace(/ö/g, "o")
            .replace(/Ç/g, "C")
            .replace(/ç/g, "c");
        const map = {
            А: "A", а: "a", Б: "B", б: "b", В: "V", в: "v",
            Г: "G", г: "g", Д: "D", д: "d", Е: "E", е: "e",
            Ё: "Yo", ё: "yo", Ж: "Zh", ж: "zh", З: "Z", з: "z",
            И: "I", и: "i", Й: "Y", й: "y", К: "K", к: "k",
            Л: "L", л: "l", М: "M", м: "m", Н: "N", н: "n",
            О: "O", о: "o", П: "P", п: "p", Р: "R", р: "r",
            С: "S", с: "s", Т: "T", т: "t", У: "U", у: "u",
            Ф: "F", ф: "f", Х: "Kh", х: "kh", Ц: "Ts", ц: "ts",
            Ч: "Ch", ч: "ch", Ш: "Sh", ш: "sh", Щ: "Shch", щ: "shch",
            Ъ: "", ъ: "", Ы: "Y", ы: "y", Ь: "", ь: "",
            Э: "E", э: "e", Ю: "Yu", ю: "yu", Я: "Ya", я: "ya",
        };
        return n
            .split("")
            .map((c) => (map[c] !== undefined ? map[c] : c))
            .join("");
    }

    slugify(n) {
        let s = this.transliterate(n);
        s = s.replace(/ /g, "_");
        s = s.replace(/[^A-Za-z0-9_-]+/g, "-");
        s = s.replace(/-+/g, "-");
        s = s.replace(/^-|-$/g, "");

        if (s.length > 192) {
            s = s.substring(0, 192);
            s = s.replace(/-$/, "");
        }

        return s;
    }

    /**
     * Get repository metadata from active note's frontmatter
     */
    async getRepositoryMetadata(note) {
        if (!note) return null;

        const cache = this.app.metadataCache.getFileCache(note);
        if (!cache?.frontmatter) return null;

        const repoUrl = cache.frontmatter[this.settings.propertyName];
        if (!repoUrl) return null;

        return {
            url: repoUrl,
            localPath: cache.frontmatter.local_path || null,
            readmeLink: cache.frontmatter.readme_link || null
        };
    }

    /**
     * Get repository folder path for a given note
     */
    getRepositoryPath(note) {
        const slug = this.slugify(note.basename);
        const folderName = `${slug}${this.settings.folderSuffix}`;
        const parentPath = note.parent.path;
        return `${parentPath}/${folderName}`;
    }

    /**
     * Execute git command with error handling
     */
    async executeGitCommand(command, cwd) {
        try {
            const { stdout, stderr } = await execAsync(command, { cwd });
            return { success: true, stdout, stderr };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                stderr: error.stderr,
                stdout: error.stdout
            };
        }
    }

    /**
     * Clone repository from active note
     */
    async cloneRepository() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== "md") {
            new Notice("Please open a markdown note with repo_url property");
            return;
        }

        // Get repository metadata
        const metadata = await this.getRepositoryMetadata(activeFile);
        if (!metadata || !metadata.url) {
            new Notice(`Please add ${this.settings.propertyName} property to this note first`);
            return;
        }

        // Get repository path
        const repoPath = this.getRepositoryPath(activeFile);
        const vaultPath = this.app.vault.adapter.basePath;
        const fullRepoPath = `${vaultPath}/${repoPath}`;

        // Check if repository folder already exists
        const folderExists = await this.app.vault.adapter.exists(repoPath);
        if (folderExists) {
            // Ask if user wants to update instead
            const modal = new ConfirmModal(
                this.app,
                "Repository folder exists",
                "Repository folder already exists. Would you like to update it instead?",
                async () => {
                    await this.updateRepository();
                }
            );
            modal.open();
            return;
        }

        // Check if git is installed
        const gitCheck = await this.executeGitCommand("git --version", vaultPath);
        if (!gitCheck.success) {
            new Notice("Git not found. Please install git: sudo apt install git");
            return;
        }

        // Clone repository
        new Notice(`Cloning repository from ${metadata.url}...`);
        const cloneResult = await this.executeGitCommand(
            `git clone "${metadata.url}" "${fullRepoPath}"`,
            vaultPath
        );

        if (!cloneResult.success) {
            new Notice(`Failed to clone repository: ${cloneResult.error}`);
            console.error("Clone error:", cloneResult);
            return;
        }

        new Notice("Repository cloned successfully!");

        // Update frontmatter
        await this.updateNoteFrontmatter(activeFile, repoPath);

        // Insert README link if enabled
        if (this.settings.autoInsertReadmeLink) {
            await this.insertReadmeLink();
        }
    }

    /**
     * Update repository (fetch and pull)
     */
    async updateRepository() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== "md") {
            new Notice("Please open a markdown note with a cloned repository");
            return;
        }

        // Get repository metadata
        const metadata = await this.getRepositoryMetadata(activeFile);
        if (!metadata || !metadata.url) {
            new Notice(`Please add ${this.settings.propertyName} property to this note first`);
            return;
        }

        // Get repository path
        const repoPath = this.getRepositoryPath(activeFile);
        const vaultPath = this.app.vault.adapter.basePath;
        const fullRepoPath = `${vaultPath}/${repoPath}`;

        // Check if repository exists
        const folderExists = await this.app.vault.adapter.exists(repoPath);
        if (!folderExists) {
            new Notice("Repository folder not found. Clone it first.");
            return;
        }

        // Check git status
        const statusResult = await this.executeGitCommand("git status --porcelain", fullRepoPath);
        if (!statusResult.success) {
            new Notice("Failed to check repository status");
            return;
        }

        const isDirty = statusResult.stdout.trim().length > 0;

        if (isDirty) {
            if (this.settings.dirtyTreeBehavior === "warn") {
                const modal = new ConfirmModal(
                    this.app,
                    "Uncommitted changes detected",
                    "Repository has uncommitted changes. Continue with update?",
                    async () => {
                        await this.performUpdate(fullRepoPath, activeFile, repoPath);
                    }
                );
                modal.open();
                return;
            } else if (this.settings.dirtyTreeBehavior === "skip") {
                new Notice("Repository has uncommitted changes. Skipping update.");
                return;
            }
        }

        await this.performUpdate(fullRepoPath, activeFile, repoPath);
    }

    /**
     * Perform the actual update (fetch and pull)
     */
    async performUpdate(fullRepoPath, activeFile, repoPath) {
        new Notice("Updating repository...");

        // Fetch
        const fetchResult = await this.executeGitCommand("git fetch --all", fullRepoPath);
        if (!fetchResult.success) {
            new Notice(`Failed to fetch: ${fetchResult.error}`);
            return;
        }

        // Pull
        const pullResult = await this.executeGitCommand("git pull", fullRepoPath);
        if (!pullResult.success) {
            new Notice(`Failed to pull: ${pullResult.error}`);
            return;
        }

        new Notice("Repository updated successfully!");

        // Update last_updated in frontmatter
        await this.app.fileManager.processFrontMatter(activeFile, (fm) => {
            fm.last_updated = new Date().toISOString();
        });
    }

    /**
     * Update note frontmatter with repository information
     */
    async updateNoteFrontmatter(note, repoPath) {
        // Find README file
        const readmeVariants = [
            "README.md", "readme.md", "Readme.md", "README", "readme",
            ".github/README.md", ".github/readme.md", ".github/Readme.md", ".github/README", ".github/readme"
        ];
        let readmePath = null;
        let readmeWikilink = null;

        for (const variant of readmeVariants) {
            const testPath = `${repoPath}/${variant}`;
            const exists = await this.app.vault.adapter.exists(testPath);
            if (exists) {
                // Relative path for local_path style reference
                readmePath = `./${this.slugify(note.basename)}${this.settings.folderSuffix}/${variant}`;
                // Full vault path for wikilink (remove .md extension for cleaner link)
                const fullPath = `${repoPath}/${variant}`;
                readmeWikilink = `[[${fullPath.replace(/\.md$/, "")}]]`;
                break;
            }
        }

        // Update frontmatter
        await this.app.fileManager.processFrontMatter(note, (fm) => {
            fm.local_path = `./${this.slugify(note.basename)}${this.settings.folderSuffix}`;
            if (readmePath) {
                fm.readme_link = readmePath;
            }
            if (readmeWikilink) {
                fm.readme = readmeWikilink;
            }
            fm.clone_date = new Date().toISOString();
            fm.last_updated = new Date().toISOString();
        });
    }

    /**
     * Insert README link into the note
     */
    async insertReadmeLink() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== "md") {
            new Notice("Please open a markdown note");
            return;
        }

        // Get repository path to find README
        const repoPath = this.getRepositoryPath(activeFile);
        const metadata = await this.getRepositoryMetadata(activeFile);

        if (!metadata || !metadata.url) {
            new Notice("No repository URL found in frontmatter");
            return;
        }

        // Find README file
        const readmeVariants = [
            "README.md", "readme.md", "Readme.md", "README", "readme",
            ".github/README.md", ".github/readme.md", ".github/Readme.md", ".github/README", ".github/readme"
        ];
        let readmeVaultPath = null;

        for (const variant of readmeVariants) {
            const testPath = `${repoPath}/${variant}`;
            const exists = await this.app.vault.adapter.exists(testPath);
            if (exists) {
                // Remove .md extension for wikilink
                readmeVaultPath = testPath.replace(/\.md$/, "");
                break;
            }
        }

        if (!readmeVaultPath) {
            new Notice("No README file found in repository");
            return;
        }

        // Read current content
        let content = await this.app.vault.read(activeFile);

        // Check if README wikilink already exists
        if (content.includes(`[[${readmeVaultPath}]]`) || content.includes("📖 README")) {
            new Notice("README link already exists in note");
            return;
        }

        // Find insertion point (after frontmatter)
        const lines = content.split("\n");
        let insertIndex = 0;
        let inFrontmatter = false;

        for (let i = 0; i < lines.length; i++) {
            if (i === 0 && lines[i].trim() === "---") {
                inFrontmatter = true;
                continue;
            }
            if (inFrontmatter && lines[i].trim() === "---") {
                inFrontmatter = false;
                insertIndex = i + 1;
                break;
            }
        }

        // Build README section with clickable wikilink
        const readmeSection = `
## 📖 README

![[${readmeVaultPath}]]

---
`;

        // Insert content
        lines.splice(insertIndex, 0, readmeSection);
        const newContent = lines.join("\n");

        await this.app.vault.modify(activeFile, newContent);
        new Notice("README link inserted successfully!");
    }

    /**
     * Open repository in terminal
     */
    async openInTerminal() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice("Please open a note");
            return;
        }

        const repoPath = this.getRepositoryPath(activeFile);
        const vaultPath = this.app.vault.adapter.basePath;
        const fullRepoPath = `${vaultPath}/${repoPath}`;

        const exists = await this.app.vault.adapter.exists(repoPath);
        if (!exists) {
            new Notice("Repository folder not found");
            return;
        }

        // Open terminal (Linux)
        const terminalResult = await this.executeGitCommand(
            `gnome-terminal --working-directory="${fullRepoPath}" || xterm -e "cd '${fullRepoPath}' && bash"`,
            vaultPath
        );

        if (!terminalResult.success) {
            new Notice("Failed to open terminal. Try manually: " + fullRepoPath);
            console.error("Terminal error:", terminalResult);
        }
    }
};

/**
 * Confirmation modal
 */
class ConfirmModal extends Modal {
    constructor(app, title, message, onConfirm) {
        super(app);
        this.title = title;
        this.message = message;
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: this.title });
        contentEl.createEl("p", { text: this.message });

        const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });

        const confirmBtn = buttonContainer.createEl("button", { text: "Yes" });
        confirmBtn.classList.add("mod-cta");
        confirmBtn.addEventListener("click", () => {
            this.close();
            this.onConfirm();
        });

        const cancelBtn = buttonContainer.createEl("button", { text: "Cancel" });
        cancelBtn.addEventListener("click", () => {
            this.close();
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

/**
 * Settings tab
 */
class GitHubRepositoryManagerSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl("h2", { text: "GitHub Repository Manager Settings" });

        // General Settings
        containerEl.createEl("h3", { text: "General Settings" });

        new Setting(containerEl)
            .setName("Folder suffix")
            .setDesc("Suffix for repository folders (locked: _repository)")
            .addText((text) =>
                text
                    .setPlaceholder("_repository")
                    .setValue(this.plugin.settings.folderSuffix)
                    .setDisabled(true)
            );

        new Setting(containerEl)
            .setName("Property name")
            .setDesc("Frontmatter property for repository URL (locked: repo_url)")
            .addText((text) =>
                text
                    .setPlaceholder("repo_url")
                    .setValue(this.plugin.settings.propertyName)
                    .setDisabled(true)
            );

        // Update Options
        containerEl.createEl("h3", { text: "Update Options" });

        new Setting(containerEl)
            .setName("Dirty working tree behavior")
            .setDesc("What to do when repository has uncommitted changes")
            .addDropdown((dropdown) =>
                dropdown
                    .addOption("warn", "Warn (ask user)")
                    .addOption("stash", "Stash changes")
                    .addOption("skip", "Skip update")
                    .setValue(this.plugin.settings.dirtyTreeBehavior)
                    .onChange(async (value) => {
                        this.plugin.settings.dirtyTreeBehavior = value;
                        await this.plugin.saveSettings();
                    })
            );

        // Integration
        containerEl.createEl("h3", { text: "Integration" });

        new Setting(containerEl)
            .setName("Auto-insert README link")
            .setDesc("Automatically insert README link after cloning")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.autoInsertReadmeLink)
                    .onChange(async (value) => {
                        this.plugin.settings.autoInsertReadmeLink = value;
                        await this.plugin.saveSettings();
                    })
            );
    }
}
