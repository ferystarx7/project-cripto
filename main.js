/**
 * =============================================================================
 * == FA STARX BOT v18.0.0 (Private Notification Fix)
 * ==
 * == SCRIPT GABUNGAN
 * ==
 * == PERUBAHAN (v18.0.0):
 * == 1. [ARSITEKTUR] Desain notifikasi dirombak total untuk multi-sesi.
 * == 2. [FIX] Menghentikan "notifikasi tembus" (notification bleed).
 * == 3. [BARU] Setiap sesi (CryptoAutoTx) sekarang memiliki variabel
 * ==    pribadi: `this.sessionNotificationChatId`.
 * == 4. [REFACTOR] TelegramFullController tidak lagi menyimpan Chat ID
 * ==    notifikasi secara global (`this.config.TELEGRAM_CHAT_ID`).
 * == 5. [REFACTOR] `processNotificationChatId` sekarang menyimpan Chat ID
 * ==    ke `cryptoApp.sessionNotificationChatId` (milik sesi pribadi).
 * == 6. [REFACTOR] Semua fungsi pengirim notifikasi di CryptoAutoTx
 * ==    (handleTransactionRequest, handleSessionProposal, dll.)
 * ==    sekarang mengirim HANYA ke `this.sessionNotificationChatId`.
 * == 7. [REFACTOR] Fungsi `sendNotification` global di TelegramFullController
 * ==    dihapus karena sudah usang dan merupakan sumber masalah.
 * =============================================================================
 */

// ===== DEPENDENCIES (GABUNGAN) =====
const { ethers } = require('ethers');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const dotenv = require('dotenv');
const SignClient = require('@walletconnect/sign-client').default;
const TelegramBot = require('node-telegram-bot-api');

// Load .env file first
dotenv.config({ override: true });

// ===================================
// == BAGIAN BARU: ENV DECRYPTOR ==
// ===================================

/**
 * @class EnvDecryptor
 * @description Mengelola dekripsi nilai-nilai sensitif dari file .env.
 */
class EnvDecryptor {
    /**
     * @constructor
     * @description Menginisialisasi EnvDecryptor dan menghasilkan kunci konfigurasi.
     */
    constructor() {
        /**
         * @property {Buffer} configKey - Kunci enkripsi yang digunakan untuk dekripsi.
         */
        this.configKey = this.generateConfigKey();
    }

    /**
     * Menghasilkan kunci enkripsi tetap berdasarkan konstanta.
     * @returns {Buffer} Kunci enkripsi 32-byte.
     */
    generateConfigKey() {
        return crypto.pbkdf2Sync(
            'FASTARX_CONFIG_KEY_2024',
            'CONFIG_SALT_2024',
            50000, // Iterasi
            32,    // Panjang kunci (32 byte = 256 bit)
            'sha256'
        );
    }

    /**
     * Mendekripsi nilai yang diambil dari .env.
     * @param {string} encryptedValue - Nilai terenkripsi (format: data_base64:iv_hex).
     * @returns {string|null} Nilai plaintext yang telah didekripsi, or null jika input tidak valid.
     * @throws {Error} Jika dekripsi gagal.
     */
    decryptValue(encryptedValue) {
        if (!encryptedValue) {
            return null;
        }
        try {
            const key = this.configKey;
            const parts = encryptedValue.split(':');
            if (parts.length !== 2) {
                if (!encryptedValue) return null;
                if (!encryptedValue.includes(':') && encryptedValue.length > 20) {
                     // console.warn(`⚠️ Warning: Nilai "${encryptedValue.substring(0, 10)}..." mungkin tidak terenkripsi.`);
                }
                throw new Error('Format nilai terenkripsi tidak valid.');
            }
            
            const encryptedData = parts[0];
            const iv = Buffer.from(parts[1], 'hex');
            
            const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
            
            let decrypted = decipher.update(encryptedData, 'base64', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        } catch (error) {
            console.error(`DECRYPTION FAILED (Value: ${encryptedValue.substring(0, 10)}...): ${error.message}`);
            return null;
        }
    }
}

// =======================================
// == BAGIAN BARU: LOAD & DECRYPT CONFIG ==
// =======================================

/**
 * Memuat dan mendekripsi semua konfigurasi rahasia dari process.env
 * @returns {Object} Objek konfigurasi yang berisi nilai-nilai plaintext.
 * @throws {Error} Jika file .env tidak ada atau dekripsi gagal.
 */
function loadConfiguration() {
    console.log('🔒 Memuat konfigurasi terenkripsi...');
    
    if (!process.env.ADMIN_PASSWORD_ENCRYPTED || !process.env.SYSTEM_ID) {
        console.error('❌ FATAL ERROR: File .env tidak ditemukan atau tidak lengkap (Sistem Keamanan).');
        console.error('Harap jalankan "node keamanan.js" terlebih dahulu.');
        process.exit(1);
    }
    
    if (!process.env.WALLETCONNECT_PROJECT_ID_ENCRYPTED) {
         console.error('❌ FATAL ERROR: File .env tidak lengkap (Bot CryptoAutoTx).');
         console.error('Harap tambahkan WALLETCONNECT_PROJECT_ID_ENCRYPTED, dll.');
        process.exit(1);
    }

    const envDecryptor = new EnvDecryptor();
    const config = {};

    try {
        // Konfigurasi Sistem Keamanan
        config.ADMIN_PASSWORD = envDecryptor.decryptValue(process.env.ADMIN_PASSWORD_ENCRYPTED);
        config.SCRIPT_PASSWORD = envDecryptor.decryptValue(process.env.SCRIPT_PASSWORD_ENCRYPTED);
        config.GITHUB_MAIN_URL = envDecryptor.decryptValue(process.env.GITHUB_MAIN_URL_ENCRYPTED);
        config.GITHUB_BACKUP_URL = envDecryptor.decryptValue(process.env.GITHUB_BACKUP_URL_ENCRYPTED);
        config.ENCRYPTION_SALT = envDecryptor.decryptValue(process.env.ENCRYPTION_SALT_ENCRYPTED);
        
        // Konfigurasi untuk CryptoAutoTx (Single Bot Token)
        config.TELEGRAM_BOT_TOKEN = envDecryptor.decryptValue(process.env.TELEGRAM_BOT_TOKEN_ENCRYPTED);

        config.WALLETCONNECT_PROJECT_ID = envDecryptor.decryptValue(process.env.WALLETCONNECT_PROJECT_ID_ENCRYPTED);
        config.DEFAULT_RPC_URL = envDecryptor.decryptValue(process.env.DEFAULT_RPC_URL_ENCRYPTED);
        config.DEFAULT_RPC_CHAIN_ID = parseInt(envDecryptor.decryptValue(process.env.DEFAULT_RPC_CHAIN_ID_ENCRYPTED), 10);
        
        const optionalKeys = ['TELEGRAM_BOT_TOKEN'];

        // Validasi
        for (const key in config) {
            if (!config[key]) {
                if (optionalKeys.includes(key) && !process.env[`${key}_ENCRYPTED`]) {
                    console.log(`ℹ️ Info: Fitur opsional "${key}" tidak dimuat.`);
                    continue; 
                }
                if (key === 'ENCRYPTION_SALT' && !process.env.ENCRYPTION_SALT_ENCRYPTED) continue; 
                
                throw new Error(`Gagal mendekripsi "${key}" dari .env`);
            }
        }
        
        if (isNaN(config.DEFAULT_RPC_CHAIN_ID)) {
             throw new Error(`DEFAULT_RPC_CHAIN_ID bukan angka yang valid.`);
        }

    } catch (error) {
        console.error('❌ FATAL ERROR: Tidak dapat mendekripsi konfigurasi.');
        console.error(error.message);
        process.exit(1);
    }
    
    console.log('✅ Konfigurasi terenkripsi berhasil dimuat.');
    return config;
}

// ===================================
// == UI & INPUT HANDLER
// ===================================

/**
 * @class ModernUI
 * @description Mengelola semua output visual ke terminal.
 */
class ModernUI {
    constructor() {
        this.theme = {
            primary: '\x1b[38;5;51m',
            secondary: '\x1b[38;5;141m',
            success: '\x1b[38;5;46m',
            warning: '\x1b[38;5;214m',
            error: '\x1b[38;5;203m',
            info: '\x1b[38;5;249m',
            accent: '\x1b[38;5;213m',
            reset: '\x1b[0m'
        };
        this.currentLoadingText = '';
        this.loadingInterval = null;
        this.box = {
            tl: '┏', tr: '┓', bl: '┗', br: '┛',
            h: '━', v: '│', 
            lt: '┣', rt: '┫'
        };
        this.width = process.stdout.columns || 80;
        this.boxWidth = 70;
        process.stdout.on('resize', () => {
            this.width = process.stdout.columns || 80;
        });
    }

    stripAnsi(str) {
        if (!str) return '';
        return str.replace(/\x1b\[[0-9;]*m/g, '');
    }

    getCenterPadding(elementWidth) {
        return ' '.repeat(Math.max(0, Math.floor((this.width - elementWidth) / 2)));
    }

    async typewriterEffect(text, delay = 10) {
        process.stdout.write(this.theme.accent);
        const leftPad = this.getCenterPadding(this.stripAnsi(text).length);
        process.stdout.write(leftPad);
        for (let i = 0; i < text.length; i++) {
            process.stdout.write(text[i]);
            if (delay > 0) await this.sleep(delay);
        }
        process.stdout.write(this.theme.reset + '\n');
    }

    async showAnimatedBanner(charDelay = 1, finalWait = 0) {
        console.clear();
        const bannerLines = [
            '╔══════════════════════════════════════════════════════════════════════════════╗',
            '║                                                                              ║',
            '║  ███████╗ █████╗     ███████╗████████╗ █████╗ ██████╗ ██╗  ██╗███████╗      ║',
            '║  ██╔════╝██╔══██╗    ██╔════╝╚══██╔══╝██╔══██╗██╔══██╗╚██╗██╔╝██╔════╝      ║',
            '║  █████╗  ███████║    ███████╗   ██║   ███████║██████╔╝ ╚███╔╝ ███████╗      ║',
            '║  ██╔══╝  ██╔══██║    ╚════██║   ██║   ██╔══██║██╔══██╗ ██╔██╗ ╚════██║      ║',
            '║  ██║     ██║  ██║    ███████║   ██║   ██║  ██║██║  ██║██╔╝ ██╗███████║      ║',
            '║  ╚═╝     ╚═╝  ╚═╝    ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝      ║',
            '║                                                                              ║',
            '║                   🚀 MULTI-CHAIN TRANSFER BOT v18.0.0 🚀                     ║',
            '║                                                                              ║',
            '╚══════════════════════════════════════════════════════════════════════════════╝'
        ];
        for (const line of bannerLines) {
            await this.typewriterEffect(line, charDelay);
        }
        console.log(this.theme.reset + '\n');
        if (finalWait > 0) await this.sleep(finalWait);
    }
    
    createBox(title, content, type = 'info') {
        const colors = {
            info: this.theme.primary,
            success: this.theme.success,
            warning: this.theme.warning,
            error: this.theme.error
        };
        const color = colors[type] || this.theme.primary;
        const innerWidth = this.boxWidth - 4;
        const leftPad = this.getCenterPadding(this.boxWidth);

        console.log(leftPad + color + this.box.tl + this.box.h.repeat(innerWidth + 2) + this.box.tr + this.theme.reset);
        const cleanTitle = this.stripAnsi(title);
        const titlePadding = ' '.repeat(innerWidth + 1 - cleanTitle.length);
        console.log(leftPad + color + this.box.v + this.theme.reset + ' ' + this.theme.accent + title + this.theme.reset + titlePadding + color + this.box.v + this.theme.reset);
        console.log(leftPad + color + this.box.lt + this.box.h.repeat(innerWidth + 2) + this.box.rt + this.theme.reset);
        const lines = Array.isArray(content) ? content : content.split('\n');
        lines.forEach(line => {
            const cleanLine = this.stripAnsi(line);
            const linePadding = ' '.repeat(Math.max(0, innerWidth + 1 - cleanLine.length));
            console.log(leftPad + color + this.box.v + this.theme.reset + ' ' + line + linePadding + color + this.box.v + this.theme.reset);
        });
        console.log(leftPad + color + this.box.bl + this.box.h.repeat(innerWidth + 2) + this.box.br + this.theme.reset + '\n');
    }

    showNotification(type, message, title = null) {
        const icons = { 
            success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️',
        };
        const titles = {
            success: 'SUCCESS', error: 'ERROR', warning: 'WARNING', info: 'INFO',
        };
        this.stopLoading();
        const notifTitle = title || titles[type];
        const icon = icons[type] || '📢';
        
        if (Array.isArray(title)) {
            this.createBox(`${icon} ${message}`, title, type);
        } else {
            this.createBox(`${icon} ${notifTitle}`, [message], type);
        }
    }

    startLoading(text) {
        this.stopLoading();
        this.currentLoadingText = text;
        const frames = ['⣾', '⣽', '⣻', '⢿', '⣟', '⣯', '⣷'];
        let i = 0;
        const textWidth = this.stripAnsi(text).length + 2;
        const leftPad = this.getCenterPadding(textWidth);
        this.loadingInterval = setInterval(() => {
            process.stdout.write(`\r\x1b[K`);
            process.stdout.write(leftPad + this.theme.secondary + frames[i] + this.theme.reset + ' ' + text);
            i = (i + 1) % frames.length;
        }, 120);
    }

    stopLoading() {
        if (this.loadingInterval) {
            clearInterval(this.loadingInterval);
            this.loadingInterval = null;
            process.stdout.write('\r\x1b[K');
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

/**
 * @class InputHandler
 * @description Mengelola semua input pengguna dari terminal.
 */
class InputHandler {
    /**
     * @constructor
     * @param {readline.Interface} rl - Interface readline yang dibagikan.
     */
    constructor(rl) {
        this.rl = rl;
        this.ui = new ModernUI(); 
    }

    question(prompt) {
        return new Promise((resolve) => {
            if (!this.rl) {
                console.error('FATAL: InputHandler.question dipanggil tanpa readline interface.');
                resolve(''); 
                return;
            }
            
            const boxPadding = this.ui.getCenterPadding(this.ui.boxWidth);
            const leftPad = boxPadding + '  '; 
            const fullPrompt = `\n${leftPad}${this.ui.theme.secondary}» ${prompt}:${this.ui.theme.reset} `;
            this.rl.question(fullPrompt, (answer) => {
                resolve(answer.trim());
            });
        });
    }

    close() {
        // Penutupan ditangani oleh main()
    }
}

// ===================================
// == GITHUB PASSWORD SYNC SYSTEM
// ===================================

/**
 * @class GitHubPasswordSync
 * @description Mengelola seluruh sistem keamanan, login, integritas file,
 * dan validasi GitHub.
 */
class GitHubPasswordSync {
    /**
     * @constructor
     * @param {readline.Interface | null} rl - Interface readline (null jika mode Telegram).
     * @param {string} adminPassword - Password admin
     * ... (parameter lainnya)
     */
    constructor(rl, adminPassword, scriptPassword, mainUrl, backupUrl, salt) {
        this.ui = new ModernUI();
        this.input = new InputHandler(rl);
        
        this.securityFiles = [
            '.security-system-marker', '.secure-backup-marker', '.fastarx-ultra-secure',
            '.system-integrity-check', '.permanent-security', '.admin-password-secure',
            '.github-validation-lock', '.dual-backup-evidence'
        ];
        this.githubSources = [
            { name: "MAIN", url: mainUrl },
            { name: "BACKUP", url: backupUrl }
        ];
        this.adminPassword = adminPassword;
        this.scriptPassword = scriptPassword;
        this.githubStatus = {
            MAIN: { connected: false, password: null },
            BACKUP: { connected: false, password: null }
        };
        this.consensusAchieved = false;
        this.systemLocked = false; 
        this.encryptionConfig = {
            algorithm: 'aes-256-gcm',
            keyIterations: 100000,
            keyLength: 32,
            salt: salt || crypto.randomBytes(16).toString('hex'), 
            digest: 'sha256'
        };
        this.masterKey = this.generateMasterKey();
    }

    generateMasterKey() {
        return crypto.pbkdf2Sync(
            'FASTARX_SECURE_MASTER_KEY_2024',
            this.encryptionConfig.salt,
            this.encryptionConfig.keyIterations,
            this.encryptionConfig.keyLength,
            this.encryptionConfig.digest
        );
    }

    encryptData(plaintext) {
        try {
            const key = this.masterKey;
            const iv = crypto.randomBytes(16);
            const cipher = crypto.createCipheriv(this.encryptionConfig.algorithm, key, iv);
            let encrypted = cipher.update(plaintext, 'utf8', 'hex');
            encrypted += cipher.final('hex');
            const authTag = cipher.getAuthTag();
            return {
                encrypted: encrypted,
                iv: iv.toString('hex'),
                authTag: authTag.toString('hex'),
                algorithm: this.encryptionConfig.algorithm,
                timestamp: new Date().toISOString()
            };
        } catch (error) { throw new Error('Encryption failed'); }
    }

    decryptData(encryptedData) {
        try {
            const key = this.masterKey;
            const iv = Buffer.from(encryptedData.iv, 'hex');
            const authTag = Buffer.from(encryptedData.authTag, 'hex');
            const decipher = crypto.createDecipheriv(this.encryptionConfig.algorithm, key, iv);
            decipher.setAuthTag(authTag);
            let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        } catch (error) { throw new Error('Decryption failed: ' + error.message); }
    }

    async initialize() {
        console.log('🚀 INITIALIZING SECURITY SYSTEM...');
        const fileStatus = this.checkFileStatus();
        if (fileStatus.missing > 0) {
            if (fileStatus.existing === 0) {
                this.ui.showNotification('info', '📁 No security files found. Running first-time setup...');
                await this.createSecurityFiles();
                this.ui.showNotification('warning', '⚠️ Default passwords created. Please log in and change them.');
            } else {
                this.ui.showNotification('error', '🚫 TAMPERING DETECTED! Security file(s) missing. System locked.');
                this.systemLocked = true;
                return;
            }
        } else {
            console.log('✅ Security file integrity check passed.');
        }
        await this.readPasswordsFromFiles();
        const validationResult = await this.validateGitHubSources();
        if (validationResult.validated) {
            this.ui.showNotification('success', '✅ GitHub validation successful!');
        }
        return true;
    }

    async createSecurityFiles() {
        console.log('📁 Creating security files...');
        let createdCount = 0;
        const timestamp = new Date().toISOString();
        for (const file of this.securityFiles) {
            const filePath = path.join(__dirname, file);
            if (!fs.existsSync(filePath)) {
                try {
                    let fileData = {};
                    if (file === '.admin-password-secure') {
                        fileData = { password: this.adminPassword, timestamp: timestamp, type: 'ADMIN_PASSWORD', securityLevel: 'HIGH' };
                    } else {
                        fileData = { password: this.scriptPassword, timestamp: timestamp, type: 'SECURITY_FILE', filePurpose: file, securityLevel: 'HIGH' };
                    }
                    if (file === '.secure-backup-marker' || file === '.system-integrity-check') {
                        fileData = { ...fileData, password: this.adminPassword, timestamp: timestamp, type: 'ADMIN_PASSWORD', isBackup: true };
                    }
                    const encryptedData = this.encryptData(JSON.stringify(fileData));
                    const finalData = { ...encryptedData, metadata: { system: 'FA_STARX_BOT', created: timestamp, version: '1.0' } };
                    fs.writeFileSync(filePath, JSON.stringify(finalData, null, 2));
                    console.log(`✅ Created: ${file}`);
                    createdCount++;
                } catch (error) { console.log(`❌ Failed to create ${file}`); }
            }
        }
        if (createdCount > 0) console.log(`🎯 ${createdCount} security files created`);
    }

    async readPasswordsFromFiles() {
        console.log('🔑 Reading passwords from security files...');
        const adminFiles = ['.admin-password-secure', '.secure-backup-marker', '.system-integrity-check'];
        const scriptFiles = this.securityFiles.filter(f => !adminFiles.includes(f));
        let adminFound = false, scriptFound = false;
        
        for (const file of adminFiles) {
            const filePath = path.join(__dirname, file);
            if (fs.existsSync(filePath)) {
                try {
                    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    const fileData = JSON.parse(this.decryptData(data));
                    if (fileData.password && fileData.type === 'ADMIN_PASSWORD') {
                        this.adminPassword = fileData.password;
                        adminFound = true;
                        console.log(`🔑 Admin password loaded from: ${file}`);
                        break;
                    }
                } catch (error) { console.log(`⚠️ Failed to read/decrypt ${file}, trying next...`); }
            }
        }
        if (!adminFound) console.log('❌ CRITICAL: Could not load admin password from any source file.');
        
        for (const file of scriptFiles) {
            const filePath = path.join(__dirname, file);
            if (fs.existsSync(filePath)) {
                try {
                    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    const fileData = JSON.parse(this.decryptData(data));
                    if (fileData.password && fileData.type === 'SECURITY_FILE') {
                        this.scriptPassword = fileData.password;
                        scriptFound = true;
                        console.log(`🔑 Script password loaded from: ${file}`);
                        break;
                    }
                } catch (error) { /* Lanjut */ }
            }
        }
        if (!scriptFound) console.log('❌ Could not load script password from any source file.');
    }

    async validateGitHubSources() {
        this.ui.startLoading('🔍 Validating GitHub sources...');
        try {
            const results = await Promise.allSettled([
                this.fetchGitHubConfig(this.githubSources[0]),
                this.fetchGitHubConfig(this.githubSources[1])
            ]);
            const validResults = [];
            this.ui.stopLoading(); 
            
            results.forEach((result, index) => {
                const source = this.githubSources[index];
                if (result.status === 'fulfilled' && result.value) {
                    this.githubStatus[source.name] = { connected: true, password: result.value };
                    validResults.push(result.value);
                    console.log(`✅ ${source.name}: Connected`);
                } else {
                    this.githubStatus[source.name] = { connected: false, password: null };
                    console.log(`❌ ${source.name}: Offline`);
                }
            });
            
            if (validResults.length === 2 && validResults[0] === validResults[1]) {
                this.consensusAchieved = true;
                this.scriptPassword = validResults[0];
                await this.updateSecurityFilesWithGitHubPassword(validResults[0]);
                return { validated: true, message: 'Dual GitHub validation passed' };
            }
            return { validated: false, message: `GitHub status: ${validResults.length}/2 connected` };
        } catch (error) {
            this.ui.stopLoading();
            return { validated: false, message: 'Validation error' };
        }
    }

    async fetchGitHubConfig(source) {
        return new Promise((resolve, reject) => {
            const url = new URL(source.url);
            const options = {
                hostname: url.hostname, port: 443, path: url.pathname, method: 'GET',
                headers: { 'User-Agent': 'FASTARX-BOT/1.0' },
                timeout: 10000
            };
            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    try {
                        if (res.statusCode === 200) {
                            const config = JSON.parse(data);
                            const password = this.extractPassword(config);
                            if (password) resolve(password);
                            else reject(new Error('No password found in JSON'));
                        } else reject(new Error(`HTTP ${res.statusCode}`));
                    } catch (error) { reject(new Error('Parse error')); }
                });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
            req.end();
        });
    }

    extractPassword(config) {
        if (config.scriptPassword) return config.scriptPassword;
        if (config.password) return config.password;
        if (config.security && config.security.password) return config.security.password;
        return null;
    }

    async updateSecurityFilesWithGitHubPassword(newPassword) {
        console.log('🔄 Updating security files with GitHub password...');
        const timestamp = new Date().toISOString();
        const adminFiles = ['.admin-password-secure', '.secure-backup-marker', '.system-integrity-check'];
        for (const file of this.securityFiles) {
            if (adminFiles.includes(file)) continue; 
            const filePath = path.join(__dirname, file);
            try {
                let fileData = {
                    password: newPassword, timestamp: timestamp, type: 'SECURITY_FILE',
                    filePurpose: file, securityLevel: 'GITHUB_VALIDATED', validatedBy: 'DUAL_GITHUB'
                };
                const encryptedData = this.encryptData(JSON.stringify(fileData));
                const finalData = { ...encryptedData, metadata: { system: 'FA_STARX_BOT', created: timestamp, githubValidated: true } };
                fs.writeFileSync(filePath, JSON.stringify(finalData, null, 2));
            } catch (error) { console.log(`❌ Failed to update ${file}`); }
        }
        this.scriptPassword = newPassword;
        console.log('✅ Script password files updated with GitHub password');
    }

    async showLoginOptions() {
        this.ui.createBox('🔐 SECURE LOGIN', [
            'FA STARX BOT SECURITY SYSTEM', '', '🔑 Login Methods:',
            '1. Administrator Access', '2. Script Password Access', '', 'Select login method:'
        ], 'info');
        return await this.input.question('Select option (1-2)');
    }

    async loginWithAdmin() {
        this.ui.createBox('🔐 ADMINISTRATOR LOGIN', [
            'Full System Access', '', '⚠️  Requires admin password', '🔒 Secure authentication', '', 'Enter administrator password:'
        ], 'warning');
        let attempts = 0;
        while (attempts < 3) {
            const inputPassword = await this.input.question('Admin Password');
            if (inputPassword === this.adminPassword) {
                return { success: true, accessLevel: 'admin' };
            } else {
                attempts++;
                const remaining = 3 - attempts;
                if (remaining > 0) this.ui.showNotification('error', `Wrong password. ${remaining} attempts left`);
                else { this.ui.showNotification('error', '🚫 ACCESS DENIED'); return { success: false, accessLevel: 'admin' }; }
            }
        }
        return { success: false, accessLevel: 'admin' };
    }

    async loginWithScript() {
        this.ui.createBox('🔐 SCRIPT LOGIN', [
            'Standard Bot Access', '', '📋 Available Features:', '• Crypto Auto-Tx (WalletConnect)', '', 'Enter script password:'
        ], 'info');
        let attempts = 0;
        while (attempts < 3) {
            const inputPassword = await this.input.question('Script Password');
            if (inputPassword === this.scriptPassword) {
                return { success: true, accessLevel: 'script' };
            } else {
                attempts++;
                const remaining = 3 - attempts;
                if (remaining > 0) this.ui.showNotification('error', `Wrong password. ${remaining} attempts left`);
                else { this.ui.showNotification('error', '🚫 ACCESS DENIED'); return { success: false, accessLevel: 'script' }; }
            }
        }
        return { success: false, accessLevel: 'script' };
    }

    async verifyAccess() {
        if (this.systemLocked) {
            this.ui.showNotification('error', 'System is locked due to file tampering. Exiting.');
            await this.ui.sleep(3000);
            process.exit(1);
        }
        const loginChoice = await this.showLoginOptions();
        if (loginChoice === '1') {
            return await this.loginWithAdmin();
        } else if (loginChoice === '2') {
            return await this.loginWithScript();
        } else {
            this.ui.showNotification('error', 'Invalid selection');
            return await this.verifyAccess();
        }
    }

    checkFileStatus() {
        let existing = 0, missing = 0;
        for (const file of this.securityFiles) {
            if (fs.existsSync(path.join(__dirname, file))) existing++;
            else missing++;
        }
        return { existing, missing };
    }
    
    close() {
        this.input.close();
    }
}

// ===================================
// == APLIKASI UTAMA: CryptoAutoTx (UPDATED v18.3 - Smart Delay)
// ===================================

class CryptoAutoTx {
    /**
     * @constructor
     * @param {readline.Interface | null} rl - Interface readline (null jika mode Telegram).
     * @param {Object} secureConfig - Objek konfigurasi yang telah didekripsi
     * @param {string} sessionId - ID unik untuk sesi ini (e.g., chatId atau 'cli_session')
     */
    constructor(rl, secureConfig, sessionId) {
        this.config = secureConfig; 
        this.rl = rl;
        this.sessionId = sessionId;
        
        this.dataDir = path.join(__dirname, 'data');
        this.ensureDataDirectory();

        this.wallet = null;
        this.provider = null;
        this.signClient = null;
        this.bot = null; 
        this.isConnected = false;
        this.session = null;
        
        // [PERBAIKAN V18] Variabel pribadi untuk notifikasi sesi ini
        this.sessionNotificationChatId = null;

        // [BARU V18.3] Variabel Smart Delay Execution
        // 0 = Instan (Normal), >0 = Jeda dalam detik
        this.executionDelay = 0; 
        
        this.walletFile = path.join(this.dataDir, `${this.sessionId}_wallets.enc`);
        this.rpcFile = path.join(this.dataDir, `${this.sessionId}_rpc-config.json`);
        
        this.masterKey = null;
        this.transactionCounts = new Map();
        
        this.currentRpc = this.config.DEFAULT_RPC_URL;
        this.currentChainId = this.config.DEFAULT_RPC_CHAIN_ID;
        this.currentRpcName = 'Default RPC (from .env)';
        
        // [UPDATE V18.1] Variable status Auto-Save RPC (Default: True/Aktif)
        this.autoSaveRpc = true; 
        
        // initTelegramBot HANYA akan jalan di mode CLI.
        if (this.rl !== null) {
            this.initTelegramBot();
        }
        
        this.loadRpcConfig(); 
    }

    ensureDataDirectory() {
        if (!fs.existsSync(this.dataDir)) {
            try {
                fs.mkdirSync(this.dataDir, { recursive: true });
                console.log(`[Session ${this.sessionId}] Membuat folder data: ${this.dataDir}`);
            } catch (error) {
                console.error(`[Session ${this.sessionId}] FATAL: Gagal membuat folder data: ${error.message}`);
                process.exit(1);
            }
        }
    }

    // 🔧 RPC CONFIGURATION SYSTEM
    loadRpcConfig() {
        try {
            if (fs.existsSync(this.rpcFile)) {
                const rpcConfig = JSON.parse(fs.readFileSync(this.rpcFile, 'utf8'));
                this.currentRpc = rpcConfig.currentRpc || this.currentRpc; 
                this.currentChainId = rpcConfig.currentChainId || this.currentChainId;
                this.currentRpcName = rpcConfig.currentRpcName || this.currentRpcName;
                this.savedRpcs = rpcConfig.savedRpcs || this.getDefaultRpcs();
                
                // [UPDATE V18.1] Load setting autoSaveRpc
                if (rpcConfig.autoSaveRpc !== undefined) {
                    this.autoSaveRpc = rpcConfig.autoSaveRpc;
                }

                // [UPDATE V18.2] Validasi struktur gasConfig untuk backward compatibility
                for (const key in this.savedRpcs) {
                    if (!this.savedRpcs[key].gasConfig) {
                        this.savedRpcs[key].gasConfig = { mode: 'auto', value: 0 };
                    }
                }

                console.log(`[Session ${this.sessionId}] Loaded RPC configuration:`, this.currentRpcName);
                console.log(`[Session ${this.sessionId}] Auto-Save RPC: ${this.autoSaveRpc ? 'ON' : 'OFF'}`);
            } else {
                console.log(`[Session ${this.sessionId}] File RPC tidak ditemukan, membuat default...`);
                this.savedRpcs = this.getDefaultRpcs();
                this.saveRpcConfig();
            }
            this.setupProvider();
        } catch (error) {
            console.log(`[Session ${this.sessionId}] Error loading RPC config, using default:`, error.message);
            this.savedRpcs = this.getDefaultRpcs();
            this.setupProvider();
        }
    }

    getDefaultRpcs() {
        const defaultFromEnv = {
            name: 'Default RPC (from .env)',
            rpc: this.config.DEFAULT_RPC_URL,
            chainId: this.config.DEFAULT_RPC_CHAIN_ID,
            gasConfig: { mode: 'auto', value: 0 }
        };

        return {
            'default_env': defaultFromEnv,
            'mainnet': {
                name: 'Ethereum Mainnet',
                rpc: 'https.eth.llamarpc.com',
                chainId: 1,
                gasConfig: { mode: 'auto', value: 0 }
            },
            'bsc': {
                name: 'BNB Smart Chain',
                rpc: 'https://bsc-dataseed.binance.org/',
                chainId: 56,
                gasConfig: { mode: 'auto', value: 0 }
            },
            'polygon': {
                name: 'Polygon Mainnet',
                rpc: 'https://polygon-rpc.com',
                chainId: 137,
                gasConfig: { mode: 'auto', value: 0 }
            }
        };
    }

    saveRpcConfig() {
        try {
            const rpcConfig = {
                currentRpc: this.currentRpc,
                currentChainId: this.currentChainId,
                currentRpcName: this.currentRpcName,
                savedRpcs: this.savedRpcs,
                // [UPDATE V18.1] Simpan setting autoSaveRpc
                autoSaveRpc: this.autoSaveRpc,
                updatedAt: new Date().toISOString()
            };
            fs.writeFileSync(this.rpcFile, JSON.stringify(rpcConfig, null, 2));
            console.log(`[Session ${this.sessionId}] RPC configuration saved`);
            return true;
        } catch (error) {
            console.log(`[Session ${this.sessionId}] Error saving RPC config:`, error.message);
            return false;
        }
    }

    setupProvider() {
        try {
            this.provider = new ethers.JsonRpcProvider(this.currentRpc);
            console.log(`[Session ${this.sessionId}] Connected to RPC: ${this.currentRpcName}`);
            console.log(`[Session ${this.sessionId}] URL: ${this.currentRpc}`);
            console.log(`[Session ${this.sessionId}] Chain ID: ${this.currentChainId}`);
            
            if (this.wallet) {
                this.wallet = this.wallet.connect(this.provider);
                console.log(`[Session ${this.sessionId}] Wallet reconnected to new RPC`);
            }
        } catch (error) {
            console.log(`[Session ${this.sessionId}] Error setting up provider:`, error.message);
            this.currentRpc = this.config.DEFAULT_RPC_URL;
            this.currentChainId = this.config.DEFAULT_RPC_CHAIN_ID;
            this.currentRpcName = 'Default Fallback';
            this.provider = new ethers.JsonRpcProvider(this.currentRpc);
        }
    }

    // Helper untuk mencari Config RPC yang sedang aktif
    getActiveRpcGasConfig() {
        // Cari RPC yang URL-nya sama dengan currentRpc
        for (const key in this.savedRpcs) {
            if (this.savedRpcs[key].rpc === this.currentRpc) {
                return this.savedRpcs[key].gasConfig || { mode: 'auto', value: 0 };
            }
        }
        // Jika tidak ketemu (custom unsaved), return default auto
        return { mode: 'auto', value: 0 };
    }

    // 🎛️ RPC MANAGEMENT MENU (CLI) - Sederhana untuk CLI, Full Feature di Telegram
    async rpcManagementMode() {
        console.log('\n🔧 PENGATURAN RPC');
        console.log('1. Pilih RPC yang tersedia');
        console.log('2. Tambah RPC baru (Manual)');
        console.log('3. Hapus RPC');
        console.log('4. Lihat RPC saat ini');
        const status = this.autoSaveRpc ? 'ON (Otomatis Simpan)' : 'OFF (Manual Input)';
        console.log(`5. Ubah Auto-Save RPC [Saat ini: ${status}]`);
        console.log('6. Kembali ke Menu Utama');
        
        const choice = await this.question('Pilih opsi (1-6): ');
        
        switch (choice) {
            case '1': await this.selectRpc(); break;
            case '2': await this.addNewRpc(); break;
            case '3': await this.deleteRpc(); break;
            case '4': await this.showCurrentRpc(); break;
            case '5': 
                this.autoSaveRpc = !this.autoSaveRpc;
                this.saveRpcConfig();
                console.log(`✅ Fitur Auto-Save RPC berhasil diubah ke: ${this.autoSaveRpc ? 'ON' : 'OFF'}`);
                break;
            case '6': return;
            default: console.log('❌ Pilihan tidak valid!');
        }
        await this.rpcManagementMode();
    }

    async selectRpc() {
        console.log('\n📡 PILIH RPC:');
        const rpcList = Object.entries(this.savedRpcs);
        if (rpcList.length === 0) {
            console.log('❌ Tidak ada RPC yang tersimpan');
            return;
        }
        let index = 1;
        for (const [key, rpc] of rpcList) {
            console.log(`${index}. ${rpc.name}`);
            console.log(`   URL: ${rpc.rpc}`);
            console.log(`   Chain ID: ${rpc.chainId}`);
            console.log('-'.repeat(40));
            index++;
        }
        const choice = await this.question(`Pilih RPC (1-${rpcList.length}): `);
        const selectedIndex = parseInt(choice) - 1;
        if (selectedIndex >= 0 && selectedIndex < rpcList.length) {
            const [key, selectedRpc] = rpcList[selectedIndex];
            this.currentRpc = selectedRpc.rpc;
            this.currentChainId = selectedRpc.chainId;
            this.currentRpcName = selectedRpc.name;
            this.setupProvider();
            this.saveRpcConfig();
            console.log(`✅ RPC berhasil diubah ke: ${selectedRpc.name}`);
        } else {
            console.log('❌ Pilihan tidak valid!');
        }
    }

    async addNewRpc() {
        console.log('\n➕ TAMBAH RPC BARU');
        const name = await this.question('Nama RPC (contoh: RPC Sepolia): ');
        const url = await this.question('URL RPC (contoh: https://...): ');
        const chainId = await this.question('Chain ID (contoh: 11155111): ');
        if (!name || !url || !chainId) {
            console.log('❌ Semua field harus diisi!');
            return;
        }
        if (!url.startsWith('http')) {
            console.log('❌ URL harus dimulai dengan http atau https');
            return;
        }
        const chainIdNum = parseInt(chainId);
        if (isNaN(chainIdNum) || chainIdNum <= 0) {
            console.log('❌ Chain ID harus angka positif');
            return;
        }
        console.log('🔄 Testing koneksi RPC...');
        try {
            const testProvider = new ethers.JsonRpcProvider(url);
            const network = await testProvider.getNetwork();
            console.log(`✅ Koneksi berhasil! Chain ID: ${network.chainId}`);
            if (network.chainId !== BigInt(chainIdNum)) {
                console.log(`⚠️ Warning: Chain ID tidak match. Input: ${chainIdNum}, Actual: ${network.chainId}`);
            }
        } catch (error) {
            console.log('❌ Gagal terkoneksi ke RPC:', error.message);
            const continueAnyway = await this.question('Tetap simpan RPC? (y/n): ');
            if (continueAnyway.toLowerCase() !== 'y') return;
        }
        const save = await this.question('Simpan RPC ini? (y/n): ');
        if (save.toLowerCase() === 'y') {
            const key = `custom_${Date.now()}`;
            // [UPDATE] Default gasConfig Auto
            this.savedRpcs[key] = { name: name, rpc: url, chainId: chainIdNum, gasConfig: { mode: 'auto', value: 0 } };
            if (this.saveRpcConfig()) {
                console.log(`✅ RPC "${name}" berhasil disimpan!`);
                const useNow = await this.question('Gunakan RPC ini sekarang? (y/n): ');
                if (useNow.toLowerCase() === 'y') {
                    this.currentRpc = url;
                    this.currentChainId = chainIdNum;
                    this.currentRpcName = name;
                    this.setupProvider();
                    console.log(`✅ Sekarang menggunakan: ${name}`);
                }
            }
        }
    }

    async deleteRpc() {
        console.log('\n🗑️ HAPUS RPC');
        const rpcList = Object.entries(this.savedRpcs);
        if (rpcList.length === 0) {
            console.log('❌ Tidak ada RPC yang tersimpan');
            return;
        }
        let index = 1;
        for (const [key, rpc] of rpcList) {
            console.log(`${index}. ${rpc.name} (${rpc.rpc})`);
            index++;
        }
        const choice = await this.question(`Pilih RPC yang akan dihapus (1-${rpcList.length}): `);
        const selectedIndex = parseInt(choice) - 1;
        if (selectedIndex >= 0 && selectedIndex < rpcList.length) {
            const [key, selectedRpc] = rpcList[selectedIndex];
            if (this.currentRpc === selectedRpc.rpc) {
                console.log('❌ Tidak bisa menghapus RPC yang sedang aktif!');
                return;
            }
            const confirm = await this.question(`Yakin hapus "${selectedRpc.name}"? (y/n): `);
            if (confirm.toLowerCase() === 'y') {
                delete this.savedRpcs[key];
                if (this.saveRpcConfig()) {
                    console.log(`✅ RPC "${selectedRpc.name}" berhasil dihapus!`);
                }
            }
        } else {
            console.log('❌ Pilihan tidak valid!');
        }
    }

    async showCurrentRpc() {
        console.log('\n📊 RPC SAAT INI:');
        console.log(`🏷️ Nama: ${this.currentRpcName}`);
        console.log(`🔗 URL: ${this.currentRpc}`);
        console.log(`⛓️ Chain ID: ${this.currentChainId}`);
        const gasConf = this.getActiveRpcGasConfig();
        console.log(`⛽ Gas Mode: ${gasConf.mode.toUpperCase()} ${gasConf.mode !== 'auto' ? `(${gasConf.value})` : ''}`);
        console.log(`💾 Total RPC tersimpan: ${Object.keys(this.savedRpcs).length}`);
        console.log(`⚙️ Auto-Save DApp: ${this.autoSaveRpc ? 'ON' : 'OFF'}`);
    }

    // 🔐 ENCRYPTION SYSTEM
    async initializeEncryption() {
        const keyFile = path.join(this.dataDir, `${this.sessionId}_master.key`);
        try {
            if (fs.existsSync(keyFile)) {
                const keyBase64 = fs.readFileSync(keyFile, 'utf8');
                this.masterKey = Buffer.from(keyBase64, 'base64');
                console.log(`[Session ${this.sessionId}] Loaded existing encryption key`);
            } else {
                this.masterKey = crypto.randomBytes(32);
                fs.writeFileSync(keyFile, this.masterKey.toString('base64'));
                console.log(`[Session ${this.sessionId}] Generated new encryption key`);
                try { fs.chmodSync(keyFile, 0o600); } catch (error) {}
            }
            return true;
        } catch (error) {
            console.log(`[Session ${this.sessionId}] Error initializing encryption:`, error.message);
            return false;
        }
    }

    encrypt(data) {
        try {
            const iv = crypto.randomBytes(16);
            const cipher = crypto.createCipheriv('aes-256-gcm', this.masterKey, iv);
            let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
            encrypted += cipher.final('hex');
            const authTag = cipher.getAuthTag();
            return {
                iv: iv.toString('hex'), data: encrypted, authTag: authTag.toString('hex'), version: '2.0'
            };
        } catch (error) {
            console.log(`[Session ${this.sessionId}] Encryption error:`, error.message);
            throw error;
        }
    }

    decrypt(encryptedData) {
        try {
            const iv = Buffer.from(encryptedData.iv, 'hex');
            const authTag = Buffer.from(encryptedData.authTag, 'hex');
            const decipher = crypto.createDecipheriv('aes-256-gcm', this.masterKey, iv);
            decipher.setAuthTag(authTag);
            let decrypted = decipher.update(encryptedData.data, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return JSON.parse(decrypted);
        } catch (error) {
            console.log(`[Session ${this.sessionId}] Decryption error:`, error.message);
            throw error;
        }
    }

    // 🔢 Get transaction count
    async getTransactionCount(address) {
        try {
            console.log(`[Session ${this.sessionId}] Getting transaction count from blockchain...`);
            const transactionCount = await this.provider.getTransactionCount(address);
            console.log(`[Session ${this.sessionId}] Total transaksi di blockchain: ${transactionCount}`);
            return transactionCount;
        } catch (error) {
            console.log(`[Session ${this.sessionId}] Error getting transaction count:`, error.message);
            return 0;
        }
    }

    // 🔢 Get wallet info
    async getWalletInfo(address) {
        try {
            console.log(`[Session ${this.sessionId}] Getting wallet info from blockchain...`);
            const currentBlock = await this.provider.getBlockNumber();
            const txCount = await this.provider.getTransactionCount(address);
            let firstSeen = (txCount > 0) ? `Active (${txCount} tx)` : 'New wallet';
            return { transactionCount: txCount, firstSeen: firstSeen, currentBlock: currentBlock };
        } catch (error) {
            console.log(`[Session ${this.sessionId}] Error getting wallet info:`, error.message);
            return { transactionCount: 0, firstSeen: 'Unknown', currentBlock: 0 };
        }
    }

    // 🔐 WALLET MANAGEMENT
    async loadWallets() {
        try {
            if (!this.masterKey) {
                await this.initializeEncryption();
            }
            if (fs.existsSync(this.walletFile)) {
                const encryptedData = JSON.parse(fs.readFileSync(this.walletFile, 'utf8'));
                if (encryptedData.iv && encryptedData.data && encryptedData.authTag) {
                    const wallets = this.decrypt(encryptedData);
                    console.log(`[Session ${this.sessionId}] Loaded encrypted wallets file`);
                    return wallets;
                } else {
                    console.log(`[Session ${this.sessionId}] Loaded plain text wallets file (legacy)`);
                    return encryptedData;
                }
            } else {
                console.log(`[Session ${this.sessionId}] File wallet tidak ditemukan. Mulai fresh.`);
            }
        } catch (error) {
            console.log(`[Session ${this.sessionId}] Error loading wallets, using empty:`, error.message);
        }
        return {};
    }

    async saveWallets(wallets) {
        try {
            if (!this.masterKey) {
                await this.initializeEncryption();
            }
            const encryptedData = this.encrypt(wallets);
            fs.writeFileSync(this.walletFile, JSON.stringify(encryptedData, null, 2));
            try { fs.chmodSync(this.walletFile, 0o600); } catch (error) {}
            console.log(`[Session ${this.sessionId}] Saved wallets with encryption`);
            return true;
        } catch (error) {
            console.log(`[Session ${this.sessionId}] Encryption failed, saving as plain text:`, error.message);
            try {
                const fallbackFile = path.join(this.dataDir, `${this.sessionId}_wallets.json`);
                fs.writeFileSync(fallbackFile, JSON.stringify(wallets, null, 2));
                console.log(`[Session ${this.sessionId}] Saved wallets as plain text (fallback)`);
                return true;
            } catch (fallbackError) {
                console.log(`[Session ${this.sessionId}] Fallback save also failed:`, fallbackError.message);
                return false;
            }
        }
    }

    async saveWallet(privateKey, nickname = '') {
        try {
            const wallets = await this.loadWallets();
            const wallet = new ethers.Wallet(privateKey);
            const address = wallet.address;
            const txCount = await this.getTransactionCount(address);
            wallets[address] = {
                privateKey: privateKey,
                nickname: nickname || `Wallet_${Object.keys(wallets).length + 1}`,
                createdAt: new Date().toISOString(),
                lastUsed: new Date().toISOString(),
                initialTxCount: txCount
            };
            if (await this.saveWallets(wallets)) {
                console.log(`[Session ${this.sessionId}] Wallet disimpan: ${address} (${wallets[address].nickname})`);
                console.log(`[Session ${this.sessionId}] Initial transaction count: ${txCount}`);
                return true;
            }
        } catch (error) {
            console.log(`[Session ${this.sessionId}] Error saving wallet:`, error.message);
        }
        return false;
    }

    async listSavedWallets() {
        const wallets = await this.loadWallets();
        if (Object.keys(wallets).length === 0) {
            console.log('📭 Tidak ada wallet yang disimpan');
            return [];
        }
        console.log('\n💼 WALLET YANG DISIMPAN:');
        console.log('='.repeat(60));
        const walletList = [];
        let index = 1;
        for (const [address, data] of Object.entries(wallets)) {
            console.log(`${index}. ${data.nickname}`);
            console.log(`   Address: ${address}`);
            console.log(`   Dibuat: ${new Date(data.createdAt).toLocaleDateString()}`);
            console.log(`   Initial TX: ${data.initialTxCount || 0}`);
            console.log('-'.repeat(40));
            walletList.push({ address, ...data });
            index++;
        }
        return walletList;
    }

    async deleteWallet(address) {
        const wallets = await this.loadWallets();
        if (wallets[address]) {
            if (this.wallet && this.wallet.address.toLowerCase() === address.toLowerCase()) {
                this.wallet = null;
                console.log(`[Session ${this.sessionId}] Wallet aktif saat ini telah dihapus dan di-deaktivasi.`);
            }
            delete wallets[address];
            if (await this.saveWallets(wallets)) {
                console.log(`[Session ${this.sessionId}] Wallet dihapus: ${address}`);
                return true;
            }
        }
        console.log(`[Session ${this.sessionId}] Wallet tidak ditemukan`);
        return false;
    }

    initTelegramBot() {
        if (!this.config.TELEGRAM_BOT_TOKEN || !this.config.TELEGRAM_CHAT_ID) {
            console.log(`[Session ${this.sessionId}] Peringatan: Konfigurasi Notifikasi Telegram (CLI) tidak lengkap. Notifikasi dinonaktifkan.`);
            return;
        }
        try {
            this.bot = new TelegramBot(this.config.TELEGRAM_BOT_TOKEN, { polling: false });
            console.log(`[Session ${this.sessionId}] Telegram Notification Bot (CLI-Mode) initialized (Send-Only)`);
        } catch (error) {
            console.log(`[Session ${this.sessionId}] Error initializing Notification bot (CLI):`, error.message);
        }
    }

    question(prompt) {
        if (!this.rl) {
            console.error(`FATAL: CryptoAutoTx.question dipanggil tanpa readline interface (mungkin dalam mode Telegram).`);
            return Promise.resolve(''); 
        }
        return new Promise((resolve) => {
            this.rl.question(prompt, resolve);
        });
    }

    async showMenu() {
        const wallets = await this.loadWallets();
        console.log('\n' + '='.repeat(50));
        console.log(`🚀 CRYPTO AUTO TRANSACTION BOT (Session: ${this.sessionId})`);
        console.log('='.repeat(50));
        console.log('⛓️ Chain ID:', this.currentChainId);
        console.log('🌐 RPC:', this.currentRpcName);
        console.log(`⚙️ Auto-Save RPC: ${this.autoSaveRpc ? 'ON' : 'OFF'}`);
        console.log('🔑 WalletConnect Project:', this.config.WALLETCONNECT_PROJECT_ID.slice(0, 4) + '...');
        console.log('💼 Saved wallets:', Object.keys(wallets).length);
        console.log('💾 Saved RPCs:', Object.keys(this.savedRpcs).length);
        console.log('='.repeat(50));
        console.log('Pilih Mode:');
        console.log('1. Setup Wallet & Connect WalletConnect');
        console.log('2. Cek Balance & Transaction Stats');
        console.log('3. Kelola Wallet');
        console.log('4. Pengaturan RPC');
        console.log('5. Keluar');
        console.log('='.repeat(50));
    }

    async walletManagementMode() {
        console.log('\n💼 KELOLA WALLET');
        console.log('1. Gunakan Wallet yang Disimpan');
        console.log('2. Import Wallet Baru');
        console.log('3. Hapus Wallet');
        console.log('4. Kembali ke Menu Utama');
        const choice = await this.question('Pilih opsi (1-4): ');
        switch (choice) {
            case '1': await this.useSavedWallet(); break;
            case '2': await this.importNewWalletCLI(); break;
            case '3': await this.deleteWalletMenu(); break;
            case '4': return;
            default: console.log('❌ Pilihan tidak valid!');
        }
        await this.walletManagementMode();
    }
    
    async importNewWalletCLI() {
        console.log('\n📥 IMPORT WALLET BARU');
        const privateKey = await this.question('Masukkan private key: ');
        if (!privateKey) {
             console.log('❌ Batal.');
             return;
        }
        
        let tempWallet;
        let pkeyFormatted = privateKey.startsWith('0x') ? privateKey : '0x' + privateKey;
        
        try {
            tempWallet = new ethers.Wallet(pkeyFormatted);
        } catch (e) {
            console.log('❌ Private key tidak valid.');
            return;
        }
        
        console.log(`📍 Address terdeteksi: ${tempWallet.address}`);
        const nickname = await this.question('Beri nama wallet (optional): ');
        
        if (await this.saveWallet(pkeyFormatted, nickname)) {
            console.log(`💾 Wallet berhasil disimpan!`);
        } else {
            console.log(`❌ Gagal menyimpan wallet.`);
        }
    }

    async useSavedWallet() {
        const walletList = await this.listSavedWallets();
        if (walletList.length === 0) return;
        const choice = await this.question(`Pilih wallet (1-${walletList.length}): `);
        const index = parseInt(choice) - 1;
        if (index >= 0 && index < walletList.length) {
            const selectedWallet = walletList[index];
            console.log(`✅ Memilih wallet: ${selectedWallet.nickname}`);
            console.log(`📍 ${selectedWallet.address}`);
            this.setupWallet(selectedWallet.privateKey);
            const currentTxCount = await this.getTransactionCount(selectedWallet.address);
            const initialTxCount = selectedWallet.initialTxCount || 0;
            const newTransactions = currentTxCount - initialTxCount;
            console.log(`📊 Transaction Stats:`);
            console.log(`   Initial: ${initialTxCount}`);
            console.log(`   Current: ${currentTxCount}`);
            console.log(`   New TX: +${newTransactions}`);
            await this.checkBalance();
            const wallets = await this.loadWallets();
            if (wallets[selectedWallet.address]) {
                wallets[selectedWallet.address].lastUsed = new Date().toISOString();
                await this.saveWallets(wallets);
            }
        } else {
            console.log('❌ Pilihan tidak valid!');
        }
    }

    async deleteWalletMenu() {
        const walletList = await this.listSavedWallets();
        if (walletList.length === 0) return;
        const choice = await this.question(`Pilih wallet yang akan dihapus (1-${walletList.length}): `);
        const index = parseInt(choice) - 1;
        if (index >= 0 && index < walletList.length) {
            const selectedWallet = walletList[index];
            const confirm = await this.question(`Yakin hapus ${selectedWallet.nickname}? (y/n): `);
            if (confirm.toLowerCase() === 'y') {
                await this.deleteWallet(selectedWallet.address);
            }
        } else {
            console.log('❌ Pilihan tidak valid!');
        }
    }

    setupWallet(privateKey) {
        try {
            if (!privateKey.startsWith('0x')) {
                privateKey = '0x' + privateKey;
            }
            this.wallet = new ethers.Wallet(privateKey, this.provider);
            console.log(`[Session ${this.sessionId}] Wallet berhasil setup: ${this.wallet.address}`);
            return true;
        } catch (error) {
            console.log(`[Session ${this.sessionId}] Error setup wallet:`, error.message);
            return false;
        }
    }

    // 🔌 WALLETCONNECT METHODS
    async initializeWalletConnect() {
        try {
            console.log(`[Session ${this.sessionId}] Initializing WalletConnect...`);
            this.signClient = await SignClient.init({
                projectId: this.config.WALLETCONNECT_PROJECT_ID,
                metadata: {
                    name: 'Crypto Auto-Tx Bot',
                    description: 'Bot untuk auto-approve transaksi',
                    url: 'https://github.com/',
                    icons: ['https://avatars.githubusercontent.com/u/37784886']
                }
            });
            console.log(`[Session ${this.sessionId}] WalletConnect initialized`);
            this.setupWalletConnectEvents();
            return true;
        } catch (error) {
            console.log(`[Session ${this.sessionId}] Error initializing WalletConnect:`, error.message);
            return false;
        }
    }

    setupWalletConnectEvents() {
        if (!this.signClient) return;
        this.signClient.on('session_proposal', async (proposal) => {
            console.log(`[Session ${this.sessionId}] Received session proposal`);
            await this.handleSessionProposal(proposal);
        });
        this.signClient.on('session_request', async (request) => {
            console.log(`[Session ${this.sessionId}] Received session request`);
            await this.handleSessionRequest(request);
        });
        this.signClient.on('session_delete', () => {
            console.log(`[Session ${this.sessionId}] Session disconnected`);
            this.isConnected = false;
            this.session = null;
            if (this.bot && this.sessionNotificationChatId) {
                this.bot.sendMessage(this.sessionNotificationChatId, `🔴 [${this.sessionId}] WALLETCONNECT DISCONNECTED`);
            }
        });
    }

    async connectWalletConnect(uri) {
        try {
            if (!this.signClient) {
                await this.initializeWalletConnect();
            }
            console.log(`[Session ${this.sessionId}] Connecting to WalletConnect URI...`);
            let correctedUri = uri;
            if (uri.startsWith('wc:') && !uri.startsWith('walletconnect:')) {
                correctedUri = 'walletconnect:' + uri;
                console.log(`[Session ${this.sessionId}] Auto-corrected URI format`);
            }
            console.log(`[Session ${this.sessionId}] Using URI:`, correctedUri);
            await this.signClient.pair({ uri: correctedUri });
            console.log(`[Session ${this.sessionId}] Pairing initiated, menunggu session proposal...`);
            return true;
        } catch (error) {
            console.log(`[Session ${this.sessionId}] Error connecting to WalletConnect:`, error.message);
            return false;
        }
    }

    // [BARU V18.3] Logic Helper untuk Jeda
    async delayExecution(actionName) {
        if (this.executionDelay > 0) {
            console.log(`[Session ${this.sessionId}] ⏳ WAITING: ${this.executionDelay}s before ${actionName}...`);
            
            // Opsional: Kirim notifikasi 'Sedang Menunggu' (bisa dihapus jika terlalu spam)
            if (this.bot && this.sessionNotificationChatId) {
                 // Hanya kirim notifikasi jika delay cukup lama (> 2 detik) agar tidak spam
                 if (this.executionDelay > 2) {
                    this.bot.sendMessage(this.sessionNotificationChatId, `⏳ [${this.sessionId}] Menunggu ${this.executionDelay} detik sebelum ${actionName}...`);
                 }
            }

            await new Promise(resolve => setTimeout(resolve, this.executionDelay * 1000));
            console.log(`[Session ${this.sessionId}] ▶️ RESUMING: Executing ${actionName} now.`);
        }
    }

    async handleSessionProposal(proposal) {
        try {
            const { id, params } = proposal;
            console.log(`[Session ${this.sessionId}] Processing session proposal...`);
            
            // [BARU V18.3] Cek Jeda sebelum Connect
            await this.delayExecution('Approving Session Connection');

            const namespaces = {
                eip155: {
                    accounts: [`eip155:${this.currentChainId}:${this.wallet.address}`],
                    methods: [
                        'eth_sendTransaction', 'eth_signTransaction', 'eth_sign',
                        'personal_sign', 'eth_signTypedData', 'eth_signTypedData_v4',
                        'wallet_addEthereumChain',    
                        'wallet_switchEthereumChain'  
                    ],
                    events: ['chainChanged', 'accountsChanged']
                }
            };
            console.log(`[Session ${this.sessionId}] Approving with namespaces:`, JSON.stringify(namespaces, null, 2));
            const approveResponse = await this.signClient.approve({ id, namespaces });
            this.session = approveResponse;
            this.isConnected = true;
            console.log(`[Session ${this.sessionId}] Session approved successfully!`);
            console.log(`[Session ${this.sessionId}] Session topic:`, this.session.topic);

            if (this.bot && this.sessionNotificationChatId) {
                this.bot.sendMessage(this.sessionNotificationChatId, 
                    `🟢 [${this.sessionId}] WALLETCONNECT TERHUBUNG!\n\n` +
                    `💳 ${this.wallet.address}\n` +
                    `⛓️ Chain ${this.currentChainId}\n` +
                    `🌐 RPC: ${this.currentRpcName}\n` +
                    `⚙️ Auto-Save RPC: ${this.autoSaveRpc ? 'ON' : 'OFF'}\n` +
                    `⏱️ Delay Mode: ${this.executionDelay}s\n` +
                    `🤖 Bot siap auto-approve transaksi!`
                );
            }
        } catch (error) {
            console.log(`[Session ${this.sessionId}] Error approving session:`, error.message);
        }
    }

    async handleSessionRequest(request) {
        try {
            const { id, topic, params } = request;
            const method = params.request?.method;
            console.log(`[Session ${this.sessionId}] Handling session request:`, method);
            
            if (method && (
                method.startsWith('eth_') || 
                method === 'personal_sign' || 
                method === 'eth_signTypedData' ||
                method === 'wallet_addEthereumChain' ||    
                method === 'wallet_switchEthereumChain'   
            )) {
                console.log(`[Session ${this.sessionId}] Transaction request detected`);
                await this.handleTransactionRequest(request);
                return;
            }
            
            await this.signClient.respond({
                topic, response: { id, jsonrpc: '2.0', result: '0x' }
            });
            console.log(`[Session ${this.sessionId}] Session request approved`);
        } catch (error) {
            console.log(`[Session ${this.sessionId}] Error handling session request:`, error.message);
            if (request.topic) {
                try {
                    await this.signClient.respond({
                        topic: request.topic,
                        response: { id: request.id, jsonrpc: '2.0', error: { code: -32000, message: error.message } }
                    });
                } catch (respondError) {
                    console.log(`[Session ${this.sessionId}] Error responding to session request:`, respondError.message);
                }
            }
        }
    }

    bigIntToString(obj) {
        if (obj === null || obj === undefined) return obj;
        if (typeof obj === 'bigint') return obj.toString();
        if (Array.isArray(obj)) return obj.map(item => this.bigIntToString(item));
        if (typeof obj === 'object') {
            const result = {};
            for (const [key, value] of Object.entries(obj)) {
                result[key] = this.bigIntToString(value);
            }
            return result;
        }
        return obj;
    }

    async handleTransactionRequest(request) {
        let method;
        try {
            const { id, topic, params } = request;
            method = params.request?.method;
            console.log('\n' + '🔔'.repeat(20));
            console.log(`[Session ${this.sessionId}] TRANSAKSI DITERIMA!`);
            console.log(`[Session ${this.sessionId}] Method:`, method);
            console.log(`[Session ${this.sessionId}] Topic:`, topic);
            
            if (!topic) throw new Error('Topic tidak ditemukan dalam request');

            // [BARU V18.3] Jeda Eksekusi Transaksi (PENTING!)
            await this.delayExecution(`Transaction (${method})`);

            let result;
            switch (method) {
                case 'eth_sendTransaction':
                    console.log(`[Session ${this.sessionId}] Transaction params:`, JSON.stringify(this.bigIntToString(params.request.params[0]), null, 2));
                    result = await this.handleSendTransaction(params.request.params[0]);
                    break;
                case 'eth_signTransaction':
                    console.log(`[Session ${this.sessionId}] Sign transaction params:`, JSON.stringify(this.bigIntToString(params.request.params[0]), null, 2));
                    result = await this.handleSignTransaction(params.request.params[0]);
                    break;
                case 'personal_sign':
                    console.log(`[Session ${this.sessionId}] Personal sign params:`, params.request.params);
                    result = await this.handlePersonalSign(params.request.params);
                    break;
                case 'eth_sign':
                    console.log(`[Session ${this.sessionId}] Eth sign params:`, params.request.params);
                    result = await this.handleEthSign(params.request.params);
                    break;
                case 'eth_signTypedData':
                case 'eth_signTypedData_v4':
                    console.log(`[Session ${this.sessionId}] Typed data params:`, JSON.stringify(this.bigIntToString(params.request.params[1]), null, 2));
                    result = await this.handleSignTypedData(params.request.params);
                    break;

                case 'wallet_addEthereumChain':
                    console.log(`[Session ${this.sessionId}] Wallet addEthereumChain params:`, params.request.params);
                    result = await this.handleAddEthereumChain(params.request.params);
                    break;
                case 'wallet_switchEthereumChain':
                    console.log(`[Session ${this.sessionId}] Wallet switchEthereumChain params:`, params.request.params);
                    result = await this.handleSwitchEthereumChain(params.request.params);
                    break;
                    
                default:
                    console.log(`[Session ${this.sessionId}] Method tidak didukung:`, method);
                    throw new Error(`Method ${method} tidak didukung`);
            }
            await this.signClient.respond({
                topic, response: { id, jsonrpc: '2.0', result }
            });
            console.log(`[Session ${this.sessionId}] Transaksi diapprove!`);
            
            if (method.startsWith('eth_') || method === 'personal_sign') {
                const txCount = await this.getTransactionCount(this.wallet.address);
                console.log(`[Session ${this.sessionId}] Total transaksi: ${txCount}`);
                
                if (this.bot && this.sessionNotificationChatId) {
                    this.bot.sendMessage(this.sessionNotificationChatId,
                        `✅ [${this.sessionId}] TRANSAKSI DIAAPPROVE!\n` +
                        `📊 Total Transaksi: ${txCount}\n\n` +
                        `💳 ${this.wallet.address}\n` +
                        `Method: ${method}\n` +
                        `⛓️ Chain: ${this.currentChainId}\n` +
                        `🌐 RPC: ${this.currentRpcName}\n` +
                        `⏱️ Delay Used: ${this.executionDelay}s\n` +
                        `🕒 ${new Date().toLocaleString()}`
                    );
                }
            } else {
                 console.log(`[Session ${this.sessionId}] Respon sukses dikirim untuk method: ${method}`);
            }

        } catch (error) {
            console.log(`[Session ${this.sessionId}] Error handling transaction:`, error.message);
            if (request.topic) {
                try {
                    await this.signClient.respond({
                        topic: request.topic,
                        response: { id: request.id, jsonrpc: '2.0', error: { code: -32000, message: error.message } }
                    });
                } catch (respondError) {
                    console.log(`[Session ${this.sessionId}] Error responding to transaction request:`, respondError.message);
                }
            }
            
            if (this.bot && this.sessionNotificationChatId) {
                this.bot.sendMessage(this.sessionNotificationChatId,
                    `❌ [${this.sessionId}] TRANSAKSI GAGAL!\n\n` +
                    `💳 ${this.wallet.address}\n` +
                    `Method: ${method}\n` +
                    `Error: ${error.message}\n` +
                    `⛓️ Chain: ${this.currentChainId}\n` +
                    `🌐 RPC: ${this.currentRpcName}\n` +
                    `🕒 ${new Date().toLocaleString()}`
                );
            }
        }
    }

    // [UPDATE V18.2] Modified handleSendTransaction to support Manual Gas
    async handleSendTransaction(txParams) {
        console.log(`[Session ${this.sessionId}] Handling send transaction...`);
        const safeTxParams = { ...txParams };
        if (!safeTxParams.chainId) {
            safeTxParams.chainId = this.currentChainId;
        }
        if (safeTxParams.gasLimit && typeof safeTxParams.gasLimit === 'bigint') {
            safeTxParams.gasLimit = safeTxParams.gasLimit.toString();
        }
        if (safeTxParams.value && typeof safeTxParams.value === 'bigint') {
            safeTxParams.value = safeTxParams.value.toString();
        }
        
        // -----------------------------------------------------
        // ⛽ GAS CONFIGURATION LOGIC (MANUAL / AGGRESSIVE)
        // -----------------------------------------------------
        const gasConfig = this.getActiveRpcGasConfig();
        console.log(`[Session ${this.sessionId}] Gas Strategy: ${gasConfig.mode.toUpperCase()}`);

        if (gasConfig.mode === 'manual' && gasConfig.value > 0) {
            // FORCE MANUAL GWEI
            const gweiValue = ethers.parseUnits(gasConfig.value.toString(), 'gwei');
            console.log(`[Session ${this.sessionId}] 🛠 FORCE GAS: ${gasConfig.value} Gwei (${gweiValue} Wei)`);
            
            // Override all fee parameters to be safe
            safeTxParams.gasPrice = gweiValue; 
            safeTxParams.maxFeePerGas = gweiValue;
            safeTxParams.maxPriorityFeePerGas = gweiValue;

        } else if (gasConfig.mode === 'aggressive' && gasConfig.value > 0) {
            // AGGRESSIVE MODE (+ Percentage)
            try {
                const feeData = await this.provider.getFeeData();
                const multiplier = 1n + (BigInt(Math.floor(gasConfig.value)) / 100n); // e.g., 20% -> 1.2
                
                // Tambahan sedikit buffer (120% secara matematika BigInt sederhana)
                // Sebenarnya multiplier di atas salah, harusnya: value=20 -> 120/100
                const boostFactor = 100n + BigInt(Math.floor(gasConfig.value));
                
                if (feeData.maxFeePerGas) {
                    safeTxParams.maxFeePerGas = (feeData.maxFeePerGas * boostFactor) / 100n;
                    safeTxParams.maxPriorityFeePerGas = (feeData.maxPriorityFeePerGas * boostFactor) / 100n;
                    console.log(`[Session ${this.sessionId}] 🚀 AGGRESSIVE GAS (+${gasConfig.value}%): ${safeTxParams.maxFeePerGas} Wei`);
                } else if (feeData.gasPrice) {
                    safeTxParams.gasPrice = (feeData.gasPrice * boostFactor) / 100n;
                    console.log(`[Session ${this.sessionId}] 🚀 AGGRESSIVE GAS PRICE (+${gasConfig.value}%): ${safeTxParams.gasPrice} Wei`);
                }
            } catch (e) {
                 console.log(`[Session ${this.sessionId}] ⚠️ Gagal fetch fee data untuk mode Aggressive, fallback ke Auto.`);
            }
        } 
        
        // AUTO MODE (FALLBACK IF PARAMS STILL MISSING)
        if (!safeTxParams.gasPrice && !safeTxParams.maxFeePerGas) {
            try {
                const feeData = await this.provider.getFeeData();
                safeTxParams.maxFeePerGas = feeData.maxFeePerGas?.toString();
                safeTxParams.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas?.toString();
                console.log(`[Session ${this.sessionId}] Using Auto maxFeePerGas: ${safeTxParams.maxFeePerGas}`);
            } catch (error) {
                console.log(`[Session ${this.sessionId}] Failed to get fee data, using defaults`);
                safeTxParams.gasPrice = '1000000000'; 
            }
        }

        console.log(`[Session ${this.sessionId}] Safe transaction params:`, JSON.stringify(this.bigIntToString(safeTxParams), null, 2));
        
        try {
            console.log(`[Session ${this.sessionId}] Estimating gas limit...`);
            const estimateParams = { ...safeTxParams };
            if (estimateParams.gasLimit) delete estimateParams.gasLimit;
            const estimatedGas = await this.provider.estimateGas(estimateParams);
            if (estimatedGas) {
                safeTxParams.gasLimit = (estimatedGas * 120n / 100n).toString(); 
                console.log(`[Session ${this.sessionId}] Estimated gas: ${estimatedGas}, using: ${safeTxParams.gasLimit}`);
            } else {
                throw new Error('Gas estimation returned undefined');
            }
        } catch (error) {
            console.log(`[Session ${this.sessionId}] Gas estimation failed, using default:`, error.message);
            safeTxParams.gasLimit = (safeTxParams.data && safeTxParams.data !== '0x') ? '100000' : '25000';
            console.log(`[Session ${this.sessionId}] Using default gas: ${safeTxParams.gasLimit}`);
        }

        console.log(`[Session ${this.sessionId}] Sending transaction with final params:`, JSON.stringify(this.bigIntToString(safeTxParams), null, 2));
        try {
            const tx = await this.wallet.sendTransaction(safeTxParams);
            console.log(`[Session ${this.sessionId}] Transaction sent:`, tx.hash);
            this.waitForConfirmation(tx.hash);
            return tx.hash;
        } catch (error) {
            console.log(`[Session ${this.sessionId}] Error sending transaction:`, error.message);
            if (error.message.includes('insufficient funds') || error.code === 'INSUFFICIENT_FUNDS') {
                throw new Error('Saldo tidak cukup untuk melakukan transaksi');
            }
            if (error.message.includes('nonce') || error.code === 'NONCE_EXPIRED') {
                throw new Error('Nonce invalid, coba restart bot');
            }
            throw error;
        }
    }

    async waitForConfirmation(txHash) {
        try {
            console.log(`[Session ${this.sessionId}] Waiting for confirmation...`);
            const receipt = await this.provider.waitForTransaction(txHash);
            if (receipt.status === 1) console.log(`[Session ${this.sessionId}] Transaction confirmed in block:`, receipt.blockNumber);
            else console.log(`[Session ${this.sessionId}] Transaction failed in block:`, receipt.blockNumber);
            return receipt;
        } catch (error) {
            console.log(`[Session ${this.sessionId}] Error waiting for confirmation:`, error.message);
            return null;
        }
    }

    async handleSignTransaction(txParams) {
        console.log(`[Session ${this.sessionId}] Handling sign transaction...`);
        const safeTxParams = { ...txParams };
        if (!safeTxParams.chainId) safeTxParams.chainId = this.currentChainId;
        if (safeTxParams.gasLimit && typeof safeTxParams.gasLimit === 'bigint') safeTxParams.gasLimit = safeTxParams.gasLimit.toString();
        if (safeTxParams.value && typeof safeTxParams.value === 'bigint') safeTxParams.value = safeTxParams.value.toString();
        const signedTx = await this.wallet.signTransaction(safeTxParams);
        console.log(`[Session ${this.sessionId}] Transaction signed`);
        return signedTx;
    }

    async handlePersonalSign(params) {
        console.log(`[Session ${this.sessionId}] Handling personal sign...`);
        const messageHex = params[0];
        const address = params[1];
        console.log(`[Session ${this.sessionId}] Original hex message: ${messageHex.substring(0, 60)}...`);
        let messageToSign;
        if (ethers.isHexString(messageHex)) {
            try {
                messageToSign = ethers.toUtf8String(messageHex);
                console.log(`[Session ${this.sessionId}] Message decoded from hex to: ${messageToSign.substring(0, 60)}...`);
            } catch (e) {
                console.log(`[Session ${this.sessionId}] Warning: Gagal decode hex, tanda tangan mentah.`);
                messageToSign = messageHex; 
            }
        } else {
            messageToSign = messageHex;
        }
        const signedMessage = await this.wallet.signMessage(messageToSign);
        console.log(`[Session ${this.sessionId}] Message signed (Final)`);
        return signedMessage;
    }

    // [UPDATE V18.1] Modified to handle autoSaveRpc toggle & [V18.2] Default Gas Config
    async handleAddEthereumChain(params) {
        const chainParams = params[0];
        console.log(`[Session ${this.sessionId}] Handling addEthereumChain:`, JSON.stringify(chainParams, null, 2));

        if (!this.autoSaveRpc) {
            console.log(`[Session ${this.sessionId}] ⚠️ Auto-Save RPC is OFF. Ignoring DApp request to add chain.`);
            if (this.bot && this.sessionNotificationChatId) {
                this.bot.sendMessage(this.sessionNotificationChatId,
                    `⚠️ [${this.sessionId}] PERMINTAAN GANTI RPC DIABAIKAN\n\n` +
                    `DApp meminta menambahkan jaringan baru, tetapi fitur Auto-Save RPC sedang OFF.\n` +
                    `Silakan tambahkan manual di menu RPC jika diperlukan.`
                );
            }
            throw new Error("User rejected the request (Auto-Save RPC is disabled).");
        }

        try {
            const chainId = parseInt(chainParams.chainId, 16);
            if (!chainId || !chainParams.rpcUrls || !chainParams.rpcUrls[0]) {
                throw new Error('Invalid chain parameters from DApp');
            }
            
            const newRpc = {
                name: chainParams.chainName || `DApp Network ${chainId}`,
                rpc: chainParams.rpcUrls[0], 
                chainId: chainId,
                symbol: chainParams.nativeCurrency?.symbol || 'ETH',
                gasConfig: { mode: 'auto', value: 0 } // [UPDATE V18.2] Default Auto
            };
            
            const key = `dapp_${chainId}`;
            this.savedRpcs[key] = newRpc;
            console.log(`[Session ${this.sessionId}] RPC baru disimpan: ${newRpc.name}`);
            
            console.log(`[Session ${this.sessionId}] Otomatis beralih ke RPC yang baru ditambahkan...`);
            
            this.currentRpc = newRpc.rpc;
            this.currentChainId = newRpc.chainId;
            this.currentRpcName = newRpc.name;
            
            this.setupProvider(); 
            this.saveRpcConfig(); 
            
            console.log(`[Session ${this.sessionId}] Berhasil beralih ke Chain ID: ${this.currentChainId}`);
            
            if (this.bot && this.sessionNotificationChatId) {
                this.bot.sendMessage(this.sessionNotificationChatId,
                    `🔄 [${this.sessionId}] RPC OTOMATIS DISIMPAN & DIGANTI\n\n` +
                    `Nama: ${newRpc.name}\n` +
                    `Chain ID: ${newRpc.chainId}\n` +
                    `Sesuai permintaan DApp (Auto-Save ON).`
                );
            }

            if (this.session && this.session.topic) {
                console.log(`[Session ${this.sessionId}] Mengirim 'updateSession' ke DApp...`);
                const newNamespaces = {
                    eip155: {
                        accounts: [`eip155:${this.currentChainId}:${this.wallet.address}`],
                        methods: [
                            'eth_sendTransaction', 'eth_signTransaction', 'eth_sign',
                            'personal_sign', 'eth_signTypedData', 'eth_signTypedData_v4',
                            'wallet_addEthereumChain', 'wallet_switchEthereumChain'
                        ],
                        events: ['chainChanged', 'accountsChanged']
                    }
                };
                await this.signClient.updateSession({
                    topic: this.session.topic,
                    namespaces: newNamespaces
                });
                console.log(`[Session ${this.sessionId}] Sesi berhasil diupdate ke Chain ID: ${this.currentChainId}`);
            }
            
            return null; 
        } catch (error) {
            console.log(`[Session ${this.sessionId}] Error adding/switching chain:`, error.message);
            throw error;
        }
    }

    async handleSwitchEthereumChain(params) {
        const { chainId: chainIdHex } = params[0];
        console.log(`[Session ${this.sessionId}] Handling switchEthereumChain to: ${chainIdHex}`);
        
        try {
            const chainIdNum = parseInt(chainIdHex, 16);
            let mustUpdateSession = false; 

            if (this.currentChainId === chainIdNum) {
                 console.log(`[Session ${this.sessionId}] Sudah berada di Chain ID ${chainIdNum}. Tidak perlu ganti.`);
                 mustUpdateSession = true;
            
            } else {
                let foundRpc = null;
                for (const key in this.savedRpcs) {
                    if (this.savedRpcs[key].chainId === chainIdNum) {
                        foundRpc = this.savedRpcs[key];
                        break;
                    }
                }

                if (foundRpc) {
                    console.log(`[Session ${this.sessionId}] RPC ditemukan, beralih ke: ${foundRpc.name}`);
                    this.currentRpc = foundRpc.rpc;
                    this.currentChainId = foundRpc.chainId;
                    this.currentRpcName = foundRpc.name;
                    this.setupProvider(); 
                    this.saveRpcConfig();
                    mustUpdateSession = true; 
                    
                    if (this.bot && this.sessionNotificationChatId) {
                        this.bot.sendMessage(this.sessionNotificationChatId,
                            `🔄 [${this.sessionId}] RPC OTOMATIS DIGANTI\n\n` +
                            `Nama: ${foundRpc.name}\n` +
                            `Chain ID: ${foundRpc.chainId}\n` +
                            `Sesuai permintaan DApp.`
                        );
                    }
                } else {
                    console.log(`[Session ${this.sessionId}] RPC untuk Chain ID ${chainIdNum} tidak ditemukan di 'savedRpcs'.`);
                    
                    if (!this.autoSaveRpc) {
                        throw new Error(`Unrecognized chain ID ${chainIdHex}. Please add it manually (Auto-Save is OFF).`);
                    }

                    throw new Error(`Unrecognized chain ID ${chainIdHex}. Please add it first using 'wallet_addEthereumChain'.`);
                }
            }

            if (mustUpdateSession && this.session && this.session.topic) {
                console.log(`[Session ${this.sessionId}] Mengirim 'updateSession' (konfirmasi) ke DApp...`);
                
                const newNamespaces = {
                    eip155: {
                        accounts: [`eip155:${this.currentChainId}:${this.wallet.address}`],
                         methods: [
                            'eth_sendTransaction', 'eth_signTransaction', 'eth_sign',
                            'personal_sign', 'eth_signTypedData', 'eth_signTypedData_v4',
                            'wallet_addEthereumChain', 'wallet_switchEthereumChain'
                        ],
                        events: ['chainChanged', 'accountsChanged']
                    }
                };
                
                await this.signClient.updateSession({
                    topic: this.session.topic,
                    namespaces: newNamespaces
                });
                
                console.log(`[Session ${this.sessionId}] Sesi berhasil diupdate ke Chain ID: ${this.currentChainId}`);
            }

            return null; 

        } catch (error) {
            console.log(`[Session ${this.sessionId}] Error switching chain:`, error.message);
            throw error;
        }
    }

    async checkBalance(chatId = null) {
        if (!this.wallet) {
            const msg = '❌ Wallet belum setup!';
            if (this.rl) console.log(msg); 
            return null;
        }
        
        try {
            console.log(`[Session ${this.sessionId}] Checking balance...`);
            const balance = await this.provider.getBalance(this.wallet.address);
            const balanceEth = ethers.formatEther(balance);
            const txCount = await this.getTransactionCount(this.wallet.address);
            
            if (this.rl) {
                console.log(`💰 Balance: ${balanceEth} ETH`);
                console.log(`💳 Address: ${this.wallet.address}`);
                console.log(`📊 Total Transactions: ${txCount}`);
                console.log(`🌐 RPC: ${this.currentRpcName}`);
            }
            
            return { balance: balanceEth, txCount: txCount };
            
        } catch (error) {
            console.log(`[Session ${this.sessionId}] Error checking balance:`, error.message);
            if (this.rl) console.log(`❌ Error: ${error.message}`);
            return null;
        }
    }

    async autoTransactionMode() {
        console.log('\n🎯 SETUP WALLET & CONNECT WALLETCONNECT');
        console.log(`🌐 RPC Saat Ini: ${this.currentRpcName}`);
        console.log(`🔗 URL: ${this.currentRpc}`);
        console.log(`⛓️ Chain ID: ${this.currentChainId}`);
        console.log(`⚙️ Auto-Save RPC: ${this.autoSaveRpc ? 'ON' : 'OFF'}`);
        
        const changeRpc = await this.question('Ganti RPC sebelum lanjut? (y/n): ');
        if (changeRpc.toLowerCase() === 'y') {
            await this.selectRpc();
        }
        await this.initializeEncryption();
        if (!this.wallet) {
            const wallets = await this.loadWallets();
            if (Object.keys(wallets).length > 0) {
                const useSaved = await this.question('Gunakan wallet yang disimpan? (y/n): ');
                if (useSaved.toLowerCase() === 'y') {
                    await this.useSavedWallet();
                    if (!this.wallet) return;
                } else {
                    const privateKey = await this.question('Masukkan private key: ');
                    if (!this.setupWallet(privateKey)) return;
                    const saveWallet = await this.question('Simpan wallet ini? (y/n): ');
                    if (saveWallet.toLowerCase() === 'y') {
                        const nickname = await this.question('Beri nama wallet (optional): ');
                        await this.saveWallet(privateKey, nickname);
                    }
                }
            } else {
                const privateKey = await this.question('Masukkan private key (Wallet tidak tersimpan): ');
                if (!this.setupWallet(privateKey)) return;
                const saveWallet = await this.question('Simpan wallet ini? (y/n): ');
                if (saveWallet.toLowerCase() === 'y') {
                    const nickname = await this.question('Beri nama wallet (optional): ');
                    await this.saveWallet(privateKey, nickname);
                }
            }
        }
        await this.checkBalance();
        console.log('\n📝 Masukkan URI WalletConnect dari web:');
        console.log('Format: wc:... atau walletconnect:wc:...');
        const uri = await this.question('URI: ');
        if (!uri || (!uri.startsWith('wc:') && !uri.startsWith('walletconnect:'))) {
            console.log('❌ URI WalletConnect tidak valid! Harus diawali wc: atau walletconnect:');
            return;
        }
        const connected = await this.connectWalletConnect(uri);
        if (!connected) return;
        console.log('\n' + '🎉'.repeat(20));
        console.log(`🤖 BOT AKTIF & STANDBY! (Session: ${this.sessionId})`);
        console.log('📡 Menunggu transaksi real dari DApp...');
        console.log('💳 Wallet:', this.wallet.address);
        console.log('⛓️ Chain ID:', this.currentChainId);
        console.log('🌐 RPC:', this.currentRpcName);
        console.log('🎉'.repeat(20));
        console.log('\nTekan Ctrl+C untuk keluar');
        
        if (this.bot && this.sessionNotificationChatId) {
             this.bot.sendMessage(this.sessionNotificationChatId,
                `🟢 [${this.sessionId}] BOT CLI AKTIF!\n\n` +
                `Status: STANDBY (Menunggu Transaksi)\n` +
                `Wallet: ${this.wallet.address}\n` +
                `Chain: ${this.currentChainId}\n` +
                `Auto-Save RPC: ${this.autoSaveRpc ? 'ON' : 'OFF'}`
            );
        }
        this.keepAlive();
    }

    keepAlive() {
        // SIGINT ditangani global
    }

    async cleanup() {
        console.log(`[Session ${this.sessionId}] Cleaning up session...`);
        if (this.signClient && this.session) {
            try {
                console.log(`[Session ${this.sessionId}] Attempting to disconnect WalletConnect session...`);
                await this.signClient.disconnect({
                    topic: this.session.topic,
                    reason: { code: 6000, message: 'User disconnected' }
                });
                console.log(`[Session ${this.sessionId}] WalletConnect session disconnected.`);
            } catch (error) {
                if (error.message.includes('Missing or invalid')) {
                    console.log(`[Session ${this.sessionId}] Session was already disconnected.`);
                } else {
                    console.log(`[Session ${this.sessionId}] Error disconnecting WalletConnect:`, error.message);
                }
            }
        }
        this.session = null;
        this.isConnected = false;

        if (this.bot && this.rl) {
            console.log(`[Session ${this.sessionId}] CLI Notification bot cleanup (no action needed).`);
        }
    }

    async run() {
        try {
            await this.showMenu();
            const choice = await this.question('Pilih mode (1-5): ');
            switch (choice) {
                case '1':
                    await this.autoTransactionMode();
                    break;
                case '2':
                    await this.checkBalance();
                    this.run();
                    break;
                case '3':
                    await this.walletManagementMode();
                    this.run();
                    break;
                case '4':
                    await this.rpcManagementMode();
                    this.run();
                    break;
                case '5':
                    console.log('👋 Keluar...');
                    await this.cleanup();
                    this.rl.close();
                    break;
                default:
                    console.log('❌ Pilihan tidak valid!');
                    this.run();
                    break;
            }
        } catch (error) {
            console.log('❌ Error:', error.message);
            await this.cleanup();
            if (this.rl) {
                 this.rl.close();
            }
        }
    }
}
// ===================================
// == MAIN EXECUTION (GABUNGAN)
// ===================================

/**
 * @function runTerminalMode
 * @description Fungsi utama aplikasi gabungan (MODE TERMINAL).
 */
async function runTerminalMode(SECURE_CONFIG) {
    let app = null;
    let mainRl = null; 
    const ui = new ModernUI(); 

    try {
        mainRl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        process.on('SIGINT', async () => {
            console.log('\n👋 Bot stopped by user (Ctrl+C). Cleaning up...');
            if (app) {
                await app.cleanup();
            }
            if (mainRl) {
                mainRl.close();
            }
            process.exit(0);
        });
    
        console.log(ui.getCenterPadding(50) + '🚀 FA STARX BOT - TERMINAL MODE');
        console.log(ui.getCenterPadding(50) + '='.repeat(50));

        const passwordSystem = new GitHubPasswordSync(
            mainRl, 
            SECURE_CONFIG.ADMIN_PASSWORD,
            SECURE_CONFIG.SCRIPT_PASSWORD,
            SECURE_CONFIG.GITHUB_MAIN_URL,
            SECURE_CONFIG.GITHUB_BACKUP_URL,
            SECURE_CONFIG.ENCRYPTION_SALT
        );
        
        await passwordSystem.initialize();

        const loginResult = await passwordSystem.verifyAccess();
        
        if (!loginResult.success) {
            ui.showNotification('error', '❌ Access denied. Exiting...');
            mainRl.close(); 
            process.exit(1);
        }

        const cliSessionId = "cli_session"; 
        
        // [PERBAIKAN V18] Logika Notifikasi CLI
        // Kita tetap *meminta* Chat ID di sini, dan menyimpannya di SECURE_CONFIG
        // agar instance CryptoAutoTx CLI dapat menggunakannya.
        // Ini tidak akan memengaruhi mode Telegram Controller.
        if (SECURE_CONFIG.TELEGRAM_BOT_TOKEN) {
            ui.createBox('💬 SETUP TELEGRAM (NOTIFIKASI PRIBADI)', [
                'Token Bot Telegram ditemukan.',
                'Silakan masukkan Chat ID Anda untuk menerima notifikasi.',
                'Ini HANYA untuk sesi terminal (CLI) Anda.',
                'Kosongkan jika tidak ingin mengaktifkan notifikasi.'
            ], 'info');
            
            const chatId = await passwordSystem.input.question('Telegram Chat ID');
            
            if (chatId) {
                // [PERBAIKAN V18] Set Chat ID agar instance CryptoAutoTx (CLI) bisa MENGIRIM
                SECURE_CONFIG.TELEGRAM_CHAT_ID = chatId; 
                ui.showNotification('success', '✅ Telegram Chat ID diterima untuk sesi CLI ini.');
            } else {
                ui.showNotification('warning', '⚠️ Chat ID kosong. Notifikasi Telegram dinonaktifkan.');
            }
        } else {
            console.log('ℹ️ Info: Token Bot Telegram (TELEGRAM_BOT_TOKEN) tidak ditemukan, notifikasi dilewati.');
        }

        ui.createBox('🎉 ACCESS GRANTED', [
            `Welcome, ${loginResult.accessLevel === 'admin' ? 'Administrator' : 'User'}!`,
            '',
            'Loading Crypto Auto-Tx Bot...'
        ], 'success');
        
        await ui.sleep(2000); 
        console.clear(); 

        app = new CryptoAutoTx(mainRl, SECURE_CONFIG, cliSessionId);
        
        // [PERBAIKAN V18] Set Chat ID notifikasi pribadi untuk sesi CLI
        if (SECURE_CONFIG.TELEGRAM_CHAT_ID) {
            app.sessionNotificationChatId = SECURE_CONFIG.TELEGRAM_CHAT_ID;
        }
        
        await app.run(); 

    } catch (error) {
        console.log(error);
        ui.stopLoading(); 
        ui.showNotification('error', `Application error: ${error.message}`);
        
        if (app) await app.cleanup();
        if (mainRl) mainRl.close(); 
        process.exit(1);
    }
}
// ===================================
// == TELEGRAM FULL CONTROLLER (UPDATED v18.3 - Smart Delay UI)
// ===================================

class TelegramFullController {
    constructor(secureConfig) {
        this.config = secureConfig;
        this.userStates = new Map();
        this.bot = null; 
        this.securitySystem = null;
        this.userSessions = new Map(); 

        this.initBot();
        this.initSecuritySystem();
    }

    initSecuritySystem() {
        this.securitySystem = new GitHubPasswordSync(
            null, 
            this.config.ADMIN_PASSWORD,
            this.config.SCRIPT_PASSWORD,
            this.config.GITHUB_MAIN_URL,
            this.config.GITHUB_BACKUP_URL,
            this.config.ENCRYPTION_SALT
        );
    }

    initBot() {
        if (this.config.TELEGRAM_BOT_TOKEN) {
            try {
                this.bot = new TelegramBot(this.config.TELEGRAM_BOT_TOKEN, { polling: true });
                console.log('🤖 Telegram Bot (V18.3 - Smart Delay UI) initialized');
                this.setupBotHandlers();
            } catch (error) {
                console.log('❌ Error initializing Main Bot:', error.message);
            }
        } else {
            console.error('FATAL: TelegramFullController dipanggil tanpa TELEGRAM_BOT_TOKEN.');
        }
    }

    setupBotHandlers() {
        this.bot.onText(/\/start/, (msg) => this.startSecurityFlow(msg.chat.id));
        this.bot.onText(/\/menu/, (msg) => this.showMainMenu(msg.chat.id));
        this.bot.onText(/\/status/, (msg) => this.sendBotStatus(msg.chat.id));
        
        this.bot.on('message', (msg) => this.handleMessage(msg));
        this.bot.on('callback_query', (query) => this.handleCallback(query));
    }

    // ===================================
    // SECURITY & AUTHENTICATION FLOW
    // ===================================

    async startSecurityFlow(chatId) {
        if (this.userSessions.has(chatId)) {
            this.showMainMenu(chatId);
            return;
        }

        await this.securitySystem.initialize();
        this.showLoginOptions(chatId);
    }

    showLoginOptions(chatId) {
        const menu = {
            reply_markup: {
                keyboard: [
                    ['1. Administrator Access'],
                    ['2. Script Password Access']
                ],
                resize_keyboard: true,
                one_time_keyboard: true
            }
        };

        this.bot.sendMessage(chatId,
            `🔐 FA STARX BOT SECURITY SYSTEM\n\n` +
            `🔑 Login Methods:\n` +
            `1. Administrator Access\n` +
            `2. Script Password Access\n\n` +
            `» Select login method:`,
            menu
        );
    }

    async handlePasswordInput(chatId, password, userState, msg) {
        try {
            let isValid = false;
            let accessLevel = '';

            try { await this.bot.deleteMessage(chatId, msg.message_id); } catch(e) {}

            if (userState.action === 'awaiting_admin_password') {
                isValid = (password === this.securitySystem.adminPassword); 
                accessLevel = 'admin';
                userState.attempts = (userState.attempts || 0) + 1;
            } else if (userState.action === 'awaiting_script_password') {
                isValid = (password === this.securitySystem.scriptPassword); 
                accessLevel = 'script';
                userState.attempts = (userState.attempts || 0) + 1;
            }

            if (isValid) {
                this.userStates.delete(chatId);

                this.bot.sendMessage(chatId,
                    `✅ LOGIN SUCCESSFUL!\n\n` +
                    `Welcome, ${accessLevel === 'admin' ? 'Administrator' : 'User'}!\n\n` +
                    `🔄 Initializing Crypto Auto-Tx Bot for your session...`
                );

                const userSession = await this.initializeCryptoApp(chatId);
                this.userSessions.set(chatId, userSession);
                
                this.requestNotificationChatId(chatId);

            } else {
                const remainingAttempts = 3 - (userState.attempts || 0);
                if (remainingAttempts > 0) {
                    this.bot.sendMessage(chatId,
                        `❌ Wrong password. ${remainingAttempts} attempts left\n\n` +
                        `» Please try again:`
                    );
                } else {
                    this.bot.sendMessage(chatId, `🚫 ACCESS DENIED - Too many failed attempts.`);
                    this.userStates.delete(chatId);
                }
            }
        } catch (error) {
            this.bot.sendMessage(chatId, `❌ Login error: ${error.message}`);
            this.userStates.delete(chatId);
        }
    }

    async initializeCryptoApp(chatId) {
        try {
            const cryptoAppInstance = new CryptoAutoTx(null, this.config, chatId); 
            cryptoAppInstance.bot = this.bot;
            await cryptoAppInstance.initializeWalletConnect();
            
            if (cryptoAppInstance.signClient) {
                cryptoAppInstance.signClient.on('session_proposal', (proposal) => {
                    this.bot.sendMessage(chatId, `🔔 NOTIFIKASI: Proposal sesi diterima. Memproses (Cek Delay)...`);
                });
                
                cryptoAppInstance.signClient.on('session_request', (request) => {
                    const method = request.params.request?.method || 'unknown';
                    this.bot.sendMessage(chatId, `🔔 NOTIFIKASI: Transaksi diterima (Method: ${method}). Memproses (Cek Delay)...`);
                });

                 cryptoAppInstance.signClient.on('session_delete', () => {
                    this.bot.sendMessage(chatId, `🔌 INFO: WalletConnect session disconnected.`);
                });
            }

            console.log(`✅ Crypto Auto-Tx Bot session initialized for user ${chatId}`);
            return cryptoAppInstance;

        } catch (error) {
            console.log(`❌ Error initializing Crypto App for ${chatId}:`, error.message);
            this.bot.sendMessage(chatId, `❌ Error initializing Crypto App: ${error.message}`);
            return null;
        }
    }

    requestNotificationChatId(chatId) {
        this.userStates.set(chatId, { action: 'awaiting_notification_chat_id' });
        
        this.bot.sendMessage(chatId,
            `💬 NOTIFICATION SETUP (PRIBADI)\n\n` +
            `Bot akan mengirim notifikasi transaksi (dari sesi ini) ke Anda.\n` +
            `Kirim "disini" untuk menggunakan chat ini (${chatId}) sebagai tujuan notifikasi.\n\n` +
            `Atau, kirim Chat ID lain (misal ID Grup) jika Anda mau:\n` +
            `(atau ketik 'skip' untuk menonaktifkan notifikasi)`
        );
    }

    async processNotificationChatId(chatId, input) {
        try {
            const cryptoApp = this.userSessions.get(chatId);
            if (!cryptoApp) {
                this.bot.sendMessage(chatId, '❌ Sesi Anda tidak ditemukan. /start ulang.');
                return;
            }

            if (input.toLowerCase() === 'skip') {
                this.bot.sendMessage(chatId, `⏭️ Notifikasi dinonaktifkan untuk sesi ini.`);
                this.userStates.delete(chatId);
                this.showMainMenu(chatId);
                return;
            }

            let notificationChatId = input.trim();
            if (notificationChatId.toLowerCase() === 'disini') {
                notificationChatId = chatId.toString();
            }
            
            if (notificationChatId && !isNaN(notificationChatId)) {
                cryptoApp.sessionNotificationChatId = notificationChatId; 
                
                console.log(`[Session ${chatId}] Set private notification ID to: ${notificationChatId}`);

                this.bot.sendMessage(chatId,
                    `✅ NOTIFICATION SETUP COMPLETE!\n\n` +
                    `Chat ID Pribadi: ${notificationChatId}\n` +
                    `Notifikasi transaksi dari sesi ini akan dikirim ke sana.`
                );
                
                try {
                     this.bot.sendMessage(notificationChatId, `🔔 TES NOTIFIKASI\nSesi ${chatId} telah terhubung ke channel ini.`);
                } catch (e) {
                     this.bot.sendMessage(chatId, `⚠️ Gagal mengirim pesan tes ke ${notificationChatId}. Pastikan bot ada di grup/channel itu.`);
                }

            } else {
                this.bot.sendMessage(chatId, `❌ Invalid Chat ID. Harus angka (atau "disini"). Coba lagi atau ketik 'skip':`);
                return;
            }
            
            this.userStates.delete(chatId);
            this.showMainMenu(chatId);

        } catch (error) {
            this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    }

    // ===================================
    // MAIN MENU & NAVIGATION
    // ===================================

    showMainMenu(chatId) {
         if (!this.userSessions.has(chatId)) {
             this.bot.sendMessage(chatId, 'Anda harus login. Kirim /start');
             return;
         }
         
        const menu = {
            reply_markup: {
                keyboard: [
                    ['💼 Wallet Management', '📊 Info & Status'],
                    ['🌐 RPC Management', '🔗 WalletConnect'],
                    ['🔐 Logout']
                ],
                resize_keyboard: true,
                one_time_keyboard: false
            }
        };

        this.bot.sendMessage(chatId,
            `🤖 CRYPTO AUTO-TX BOT - MAIN MENU\n(Session: ${chatId})\n\n` +
            `Pilih menu di bawah:\n` +
            `💼 Wallet - Kelola wallet\n` +
            `📊 Info - Balance & status\n` +
            `🌐 RPC - Kelola koneksi & Gas\n` +
            `🔗 WC - Connect DApps & Delay`,
            menu
        );
    }

    // ===================================
    // WALLET MANAGEMENT
    // ===================================

    showWalletMenu(cryptoApp, chatId) {
         if (!cryptoApp) return;
        const menu = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '📥 Import Wallet', callback_data: 'wallet_import' },
                        { text: '📋 List/Pilih Wallet', callback_data: 'wallet_list' }
                    ],
                    [
                        { text: '🗑️ Hapus Wallet', callback_data: 'wallet_delete_menu' }
                    ],
                    [
                        { text: '💰 Cek Balance', callback_data: 'wallet_balance' },
                        { text: '📊 TX Stats', callback_data: 'wallet_stats' }
                    ],
                    [
                        { text: '🔙 Main Menu', callback_data: 'main_menu' }
                    ]
                ]
            }
        };
        this.bot.sendMessage(chatId, '💼 WALLET MANAGEMENT:', menu);
    }
    
    async showDeleteWalletMenu(cryptoApp, chatId) {
        try {
            const wallets = await cryptoApp.loadWallets();
            if (Object.keys(wallets).length === 0) {
                this.bot.sendMessage(chatId, '📭 Tidak ada wallet untuk dihapus.');
                return;
            }
            const buttons = [];
            Object.entries(wallets).forEach(([address, data]) => {
                buttons.push([
                    { 
                        text: `🗑️ ${data.nickname} (${address.slice(0, 6)}...)`, 
                        callback_data: `wallet_delete_confirm_${address}` 
                    }
                ]);
            });
            buttons.push([{ text: '🔙 Batal', callback_data: 'wallet_menu' }]);
            this.bot.sendMessage(chatId, 'Pilih wallet yang akan dihapus:', {
                reply_markup: { inline_keyboard: buttons }
            });
        } catch (error) {
            this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    }

    async confirmDeleteWallet(cryptoApp, chatId, address) {
         const wallets = await cryptoApp.loadWallets();
         const walletData = wallets[address];
         if (!walletData) {
             this.bot.sendMessage(chatId, '❌ Wallet tidak ditemukan.');
             return;
         }
         const menu = {
             reply_markup: {
                 inline_keyboard: [
                     [
                         { text: `🔴 HAPUS ${walletData.nickname}`, callback_data: `wallet_delete_exec_${address}` },
                         { text: '🟢 Batal', callback_data: 'wallet_menu' }
                     ]
                 ]
             }
         };
         this.bot.sendMessage(chatId, `Yakin ingin menghapus wallet ${walletData.nickname} (${address})?`, menu);
    }

    async executeDeleteWallet(cryptoApp, chatId, address) {
        try {
            const deleted = await cryptoApp.deleteWallet(address);
            if (deleted) {
                this.bot.sendMessage(chatId, `✅ Wallet (${address}) berhasil dihapus.`);
            } else {
                this.bot.sendMessage(chatId, '❌ Gagal menghapus wallet.');
            }
            this.showWalletMenu(cryptoApp, chatId); 
        } catch (error) {
            this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    }

    async importWalletFlow(cryptoApp, chatId) {
        this.userStates.set(chatId, { action: 'awaiting_wallet_import' });
        this.bot.sendMessage(chatId,
            `📥 IMPORT WALLET\n\n` +
            `Kirim private key:\n` +
            `Format: 0x... atau tanpa 0x\n\n` +
            `⚠️ Private key akan dienkripsi dan disimpan aman (hanya untuk sesi Anda).`
        );
    }

    async processWalletImport(cryptoApp, chatId, privateKey, msg) {
        try {
            try { await this.bot.deleteMessage(chatId, msg.message_id); } catch(e) {}
            if (!privateKey.startsWith('0x')) {
                privateKey = '0x' + privateKey;
            }
            const wallet = new ethers.Wallet(privateKey);
            this.userStates.set(chatId, { 
                action: 'awaiting_wallet_name',
                tempData: { privateKey: privateKey, address: wallet.address }
            });
            this.bot.sendMessage(chatId,
                `✅ Private Key Valid!\n\n` +
                `📍 Address: ${wallet.address}\n\n` +
                `Sekarang beri nama wallet:`
            );
        } catch (error) {
            this.bot.sendMessage(chatId, `❌ Private Key invalid: ${error.message}`);
            this.userStates.delete(chatId);
        }
    }

    async processWalletName(cryptoApp, chatId, walletName) {
        const userState = this.userStates.get(chatId);
        if (!userState?.tempData) {
            this.bot.sendMessage(chatId, '❌ Session expired.');
            return;
        }
        try {
            const { privateKey, address } = userState.tempData;
            const saved = await cryptoApp.saveWallet(privateKey, walletName);
            if (saved) {
                this.bot.sendMessage(chatId,
                    `✅ WALLET BERHASIL DISIMPAN!\n\n` +
                    `🏷️ ${walletName}\n` +
                    `📍 ${address}`
                );
                this.userStates.delete(chatId);
                this.showWalletMenu(cryptoApp, chatId);
            }
        } catch (error) {
            this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            this.userStates.delete(chatId);
        }
    }

    async listWallets(cryptoApp, chatId, callbackPrefix = 'wallet_select_') {
        try {
            const wallets = await cryptoApp.loadWallets();
            if (Object.keys(wallets).length === 0) {
                this.bot.sendMessage(chatId, '📭 Tidak ada wallet.');
                return;
            }
            let message = '💼 WALLET YANG DISIMPAN:\n\n';
            const buttons = [];
            Object.entries(wallets).forEach(([address, data], index) => {
                const isActive = cryptoApp.wallet?.address?.toLowerCase() === address.toLowerCase();
                message += `${isActive ? '🟢 ' : '⚪️ '}${index + 1}. ${data.nickname}\n`;
                message += `   📍 ${address}\n`;
                message += `   📊 TX: ${data.initialTxCount || 0}\n\n`;
                buttons.push([
                    { 
                        text: `${isActive ? '🟢 ' : ''}${data.nickname}`, 
                        callback_data: `${callbackPrefix}${address}`
                    }
                ]);
            });
            if (callbackPrefix === 'wallet_select_') {
                buttons.push([{ text: '🔙 Kembali', callback_data: 'wallet_menu' }]);
            } else {
                 buttons.push([{ text: '🔙 Batal', callback_data: 'wc_menu' }]);
            }
            this.bot.sendMessage(chatId, message, {
                reply_markup: { inline_keyboard: buttons }
            });
        } catch (error) {
            this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    }

    async selectWallet(cryptoApp, chatId, address) {
        try {
            const wallets = await cryptoApp.loadWallets();
            const walletData = wallets[address];
            if (walletData) {
                const setupSuccess = cryptoApp.setupWallet(walletData.privateKey);
                if (setupSuccess) {
                    wallets[address].lastUsed = new Date().toISOString();
                    await cryptoApp.saveWallets(wallets);
                    this.bot.sendMessage(chatId,
                        `✅ WALLET DIPILIH!\n\n` +
                        `🏷️ ${walletData.nickname}\n` +
                        `📍 ${address}\n\n` +
                        `Wallet aktif dan siap digunakan.`
                    );
                    await this.checkBalance(cryptoApp, chatId);
                }
            }
        } catch (error) {
            this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    }
    
    async getTransactionStats(cryptoApp, chatId) {
        if (!cryptoApp.wallet) {
            this.bot.sendMessage(chatId, '❌ Wallet belum setup!');
            return;
        }
        try {
            this.bot.sendMessage(chatId, '📊 Getting transaction statistics...');
            const walletInfo = await cryptoApp.getWalletInfo(cryptoApp.wallet.address);
            const balance = await cryptoApp.provider.getBalance(cryptoApp.wallet.address);
            const balanceEth = ethers.formatEther(balance);
            const message = 
                `📊 TRANSACTION STATISTICS\n\n` +
                `💳 ${cryptoApp.wallet.address}\n` + 
                `💰 Balance: ${balanceEth} ETH\n` +
                `📈 Total Transactions: ${walletInfo.transactionCount}\n` +
                `🕒 Status: ${walletInfo.firstSeen}\n` +
                `⛓️ Current Block: ${walletInfo.currentBlock}\n` +
                `🔗 Chain ID: ${cryptoApp.currentChainId}\n` +
                `🌐 RPC: ${cryptoApp.currentRpcName}\n` +
                `🕒 ${new Date().toLocaleString()}`;
            this.bot.sendMessage(chatId, message);
        } catch (error) {
            this.bot.sendMessage(chatId, `❌ Error getting stats: ${error.message}`);
        }
    }


    // ===================================
    // AUTO TRANSACTION MODE (WalletConnect) & DELAY UI
    // ===================================

    showWalletConnectMenu(cryptoApp, chatId) {
         if (!cryptoApp) return;
        const status = cryptoApp.isConnected ? '🟢 TERHUBUNG' : '🔴 TIDAK TERHUBUNG';
        const walletInfo = cryptoApp.wallet ? 
            `🟢 Aktif: ${cryptoApp.wallet.address}` : 
            '🔴 Belum ada wallet aktif';
        
        // [BARU V18.3] Info Delay di Text Menu
        const delayInfo = cryptoApp.executionDelay > 0 
            ? `⏱️ Delay Aktif: ${cryptoApp.executionDelay} Detik` 
            : `⏱️ Delay: OFF (Instan)`;

        const menu = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🔄 Ganti/Pilih Wallet', callback_data: 'wc_select_wallet' }
                    ],
                    [
                        { text: '🔗 Connect WC', callback_data: 'wc_connect' },
                        { text: '🔄 Status', callback_data: 'wc_status' }
                    ],
                    // [BARU V18.3] Tombol Set Delay
                    [
                        { text: `⏱️ Set Delay (${cryptoApp.executionDelay}s)`, callback_data: 'wc_set_delay' }
                    ],
                    [
                        { text: '🔌 Disconnect', callback_data: 'wc_disconnect' },
                    ],
                    [
                        { text: '🔙 Main Menu', callback_data: 'main_menu' }
                    ]
                ]
            }
        };
        this.bot.sendMessage(chatId,
            `🔗 WALLETCONNECT\n\n` +
            `Status: ${status}\n` +
            `Wallet: ${walletInfo}\n` +
            `Chain: ${cryptoApp.currentChainId}\n` +
            `${delayInfo}\n` + // Tampilkan info delay
            `Auto-Save RPC: ${cryptoApp.autoSaveRpc ? 'ON' : 'OFF'}`,
            menu
        );
    }

    async startWalletConnect(cryptoApp, chatId) {
        if (!cryptoApp.wallet) {
            this.bot.sendMessage(chatId, '❌ Belum ada wallet aktif. Silakan pilih wallet dulu menggunakan tombol "🔄 Ganti/Pilih Wallet".');
            return;
        }
        this.userStates.set(chatId, { action: 'awaiting_wc_uri' });
        this.bot.sendMessage(chatId,
            `🔗 WALLETCONNECT SETUP\n\n` +
            `Wallet Aktif: ${cryptoApp.wallet.address}\n\n` + 
            `1. Buka DApp di browser\n` +
            `2. Pilih WalletConnect\n` +
            `3. Copy URI\n` +
            `4. Kirim URI ke sini:\n`
        );
    }

    async processWalletConnectURI(cryptoApp, chatId, uri, msg) {
        try {
            try { await this.bot.deleteMessage(chatId, msg.message_id); } catch(e) {}
            this.bot.sendMessage(chatId, '🔄 Menghubungkan ke WalletConnect...');
            const connected = await cryptoApp.connectWalletConnect(uri);
            if (connected) {
                this.bot.sendMessage(chatId,
                    `✅ PAIRING DIMULAI!\n\n` +
                    `Bot menunggu proposal dari DApp...`
                );
            } else {
                this.bot.sendMessage(chatId, '❌ Gagal memulai pairing. Cek URI.');
            }
            this.userStates.delete(chatId);
        } catch (error) {
            this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            this.userStates.delete(chatId);
        }
    }
    
    // [BARU V18.3] Fungsi Input Delay
    async requestDelayInput(cryptoApp, chatId) {
        this.userStates.set(chatId, { action: 'awaiting_delay_input' });
        this.bot.sendMessage(chatId, 
            `⏱️ SMART DELAY EXECUTION\n\n` +
            `Masukkan durasi jeda dalam **DETIK**.\n` +
            `Bot akan menunggu waktu ini sebelum menandatangani transaksi.\n\n` +
            `Kirim angka 0 untuk mematikan (Instan).\n` +
            `Contoh: 5`
        );
    }

    async processDelayInput(cryptoApp, chatId, input, msg) {
        try {
            try { await this.bot.deleteMessage(chatId, msg.message_id); } catch(e) {}
            const delaySeconds = parseInt(input);
            
            if (isNaN(delaySeconds) || delaySeconds < 0) {
                this.bot.sendMessage(chatId, '❌ Input harus angka positif atau 0. Coba lagi.');
                return;
            }
            
            cryptoApp.executionDelay = delaySeconds;
            
            const status = delaySeconds === 0 ? 'NON-AKTIF (Instan)' : `${delaySeconds} Detik`;
            
            this.bot.sendMessage(chatId, 
                `✅ DELAY TERSIMPAN!\n\n` +
                `Status: ${status}\n` +
                `Bot akan menerapkan jeda ini untuk setiap request baru.`
            );
            
            this.userStates.delete(chatId);
            this.showWalletConnectMenu(cryptoApp, chatId);
            
        } catch (error) {
            this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            this.userStates.delete(chatId);
        }
    }


    // ===================================
    // RPC & GAS MANAGEMENT (UPDATED V18.2)
    // ===================================

    showRpcMenu(cryptoApp, chatId) {
         if (!cryptoApp) return;
         
        // [UPDATE V18.1] Dynamic Button for Auto-Save Toggle
        const autoSaveStatusIcon = cryptoApp.autoSaveRpc ? '✅' : '❌';
        const autoSaveText = `Auto-Save: ${cryptoApp.autoSaveRpc ? 'ON' : 'OFF'}`;

        const menu = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '📡 Pilih RPC', callback_data: 'rpc_select' },
                        { text: '➕ Tambah RPC', callback_data: 'rpc_add' }
                    ],
                    [
                        { text: '⛽ Atur Gas', callback_data: 'rpc_gas_menu' }, // [NEW] Gas Menu
                        { text: 'ℹ️ Info RPC', callback_data: 'rpc_info' }
                    ],
                    [
                        { text: '🗑️ Hapus RPC', callback_data: 'rpc_delete_menu' }
                    ],
                    [
                         { text: `${autoSaveStatusIcon} ${autoSaveText}`, callback_data: 'rpc_toggle_autosave' }
                    ],
                    [
                        { text: '🔙 Main Menu', callback_data: 'main_menu' }
                    ]
                ]
            }
        };
        this.bot.sendMessage(chatId, '🌐 RPC MANAGEMENT:', menu);
    }
    
    // [NEW] Show List RPC for Gas Edit
    async showGasRpcSelection(cryptoApp, chatId) {
        try {
            const rpcList = Object.entries(cryptoApp.savedRpcs);
            if (rpcList.length === 0) {
                this.bot.sendMessage(chatId, '📭 Tidak ada RPC tersimpan.');
                return;
            }
            let message = '⛽ PILIH RPC UNTUK DIEDIT GAS-NYA:\n\n';
            const buttons = [];
            rpcList.forEach(([key, rpc], index) => {
                const gasMode = rpc.gasConfig?.mode || 'auto';
                const gasVal = rpc.gasConfig?.value || 0;
                const status = gasMode === 'auto' ? 'Auto' : (gasMode === 'manual' ? `${gasVal} Gwei` : `+${gasVal}%`);
                
                message += `${index + 1}. ${rpc.name} [${status}]\n`;
                
                buttons.push([
                    { 
                        text: `${rpc.name} (${status})`, 
                        callback_data: `rpc_gas_select_${key}` 
                    }
                ]);
            });
            buttons.push([{ text: '🔙 Kembali', callback_data: 'rpc_menu' }]);
            this.bot.sendMessage(chatId, message, {
                reply_markup: { inline_keyboard: buttons }
            });
        } catch (error) {
            this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    }

    // [NEW] Show Gas Mode Selection
    async showGasModeSelection(cryptoApp, chatId, rpcKey) {
        const rpc = cryptoApp.savedRpcs[rpcKey];
        if (!rpc) {
            this.bot.sendMessage(chatId, '❌ RPC tidak ditemukan.');
            return;
        }

        const menu = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '✅ Auto (Default)', callback_data: `rpc_gas_set_auto_${rpcKey}` }
                    ],
                    [
                        { text: '🛠 Manual (Gwei)', callback_data: `rpc_gas_ask_manual_${rpcKey}` },
                        { text: '🚀 Aggressive (% Boost)', callback_data: `rpc_gas_ask_aggressive_${rpcKey}` }
                    ],
                    [
                        { text: '🔙 Batal', callback_data: 'rpc_gas_menu' }
                    ]
                ]
            }
        };

        this.bot.sendMessage(chatId, 
            `⛽ SETUP GAS UNTUK: ${rpc.name}\n\n` +
            `Pilih mode:\n` +
            `• Auto: Mengikuti harga pasar (Provider)\n` +
            `• Manual: Memaksa nilai Gwei tertentu (Fixed)\n` +
            `• Aggressive: Harga pasar + Persentase`, 
            menu
        );
    }

    // [NEW] Process Manual/Aggressive Gas Input
    async processGasInput(cryptoApp, chatId, value, userState, msg) {
        try {
            // Delete input message to keep chat clean
            try { await this.bot.deleteMessage(chatId, msg.message_id); } catch(e) {}
            
            const rpcKey = userState.tempData.rpcKey;
            const mode = userState.tempData.mode; // 'manual' or 'aggressive'
            const numValue = parseFloat(value);

            if (isNaN(numValue) || numValue < 0) {
                this.bot.sendMessage(chatId, '❌ Nilai harus angka positif. Coba lagi atau ketik apa saja untuk batal.');
                return; // Jangan delete state, biarkan coba lagi
            }

            if (!cryptoApp.savedRpcs[rpcKey]) {
                this.bot.sendMessage(chatId, '❌ RPC target hilang. Setup dibatalkan.');
                this.userStates.delete(chatId);
                return;
            }

            // Update Config
            cryptoApp.savedRpcs[rpcKey].gasConfig = {
                mode: mode,
                value: numValue
            };
            cryptoApp.saveRpcConfig();

            const unit = mode === 'manual' ? 'Gwei' : '%';
            this.bot.sendMessage(chatId, 
                `✅ GAS CONFIG TERSIMPAN!\n\n` +
                `RPC: ${cryptoApp.savedRpcs[rpcKey].name}\n` +
                `Mode: ${mode.toUpperCase()}\n` +
                `Value: ${numValue} ${unit}`
            );

            this.userStates.delete(chatId);
            this.showRpcMenu(cryptoApp, chatId);

        } catch (error) {
            this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            this.userStates.delete(chatId);
        }
    }

    async showRpcInfo(cryptoApp, chatId) {
         const gasConf = cryptoApp.getActiveRpcGasConfig();
         this.bot.sendMessage(chatId,
            `ℹ️ INFORMASI RPC SAAT INI\n\n` +
            `🏷️ Nama: ${cryptoApp.currentRpcName}\n` +
            `🔗 URL: ${cryptoApp.currentRpc}\n` +
            `⛓️ Chain: ${cryptoApp.currentChainId}\n` +
            `⛽ Gas Mode: ${gasConf.mode.toUpperCase()} ${gasConf.mode !== 'auto' ? `(${gasConf.value})` : ''}\n` +
            `⚙️ Auto-Save DApp: ${cryptoApp.autoSaveRpc ? 'ON' : 'OFF'}`
        );
    }
    
    async startAddRpcFlow(cryptoApp, chatId, step = 1, data = {}) {
        this.userStates.set(chatId, { action: 'awaiting_rpc_add', step, data });
        if (step === 1) {
            this.bot.sendMessage(chatId, '➕ TAMBAH RPC (1/3)\n\Kirim Nama RPC (contoh: RPC Sepolia):');
        } else if (step === 2) {
            this.bot.sendMessage(chatId, '➕ TAMBAH RPC (2/3)\n\Kirim URL RPC (contoh: https://...):');
        } else if (step === 3) {
            this.bot.sendMessage(chatId, '➕ TAMBAH RPC (3/3)\n\Kirim Chain ID (contoh: 11155111):');
        }
    }
    
    async processAddRpc(cryptoApp, chatId, input, userState) {
        const { step, data } = userState;
        try {
            if (step === 1) {
                data.name = input;
                await this.startAddRpcFlow(cryptoApp, chatId, 2, data);
            } else if (step === 2) {
                 if (!input.startsWith('http')) {
                    this.bot.sendMessage(chatId, '❌ URL tidak valid. Harus dimulai http/https. Coba lagi:');
                    return;
                 }
                data.url = input;
                await this.startAddRpcFlow(cryptoApp, chatId, 3, data);
            } else if (step === 3) {
                 const chainIdNum = parseInt(input);
                 if (isNaN(chainIdNum) || chainIdNum <= 0) {
                    this.bot.sendMessage(chatId, '❌ Chain ID tidak valid. Harus angka positif. Coba lagi:');
                    return;
                 }
                data.chainId = chainIdNum;
                const key = `custom_${Date.now()}`;
                cryptoApp.savedRpcs[key] = { 
                    name: data.name, 
                    rpc: data.url, 
                    chainId: data.chainId,
                    gasConfig: { mode: 'auto', value: 0 } 
                };
                if (cryptoApp.saveRpcConfig()) {
                    this.bot.sendMessage(chatId, `✅ RPC "${data.name}" berhasil disimpan!`);
                    this.userStates.delete(chatId);
                    this.showRpcMenu(cryptoApp, chatId);
                } else {
                     this.bot.sendMessage(chatId, `❌ Gagal menyimpan RPC.`);
                     this.userStates.delete(chatId);
                }
            }
        } catch (error) {
             this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
             this.userStates.delete(chatId);
        }
    }
    
    async showDeleteRpcMenu(cryptoApp, chatId) {
        try {
            const rpcList = Object.entries(cryptoApp.savedRpcs);
            if (rpcList.length === 0) {
                this.bot.sendMessage(chatId, '📭 Tidak ada RPC untuk dihapus.');
                return;
            }
            const buttons = [];
            rpcList.forEach(([key, rpc]) => {
                if (cryptoApp.currentRpc === rpc.rpc) {
                     buttons.push([ { text: `🟢 ${rpc.name} (Aktif)`, callback_data: 'rpc_delete_active' } ]);
                } else {
                    buttons.push([
                        { 
                            text: `🗑️ ${rpc.name}`, 
                            callback_data: `rpc_delete_exec_${key}` 
                        }
                    ]);
                }
            });
            buttons.push([{ text: '🔙 Batal', callback_data: 'rpc_menu' }]);
            this.bot.sendMessage(chatId, 'Pilih RPC yang akan dihapus:', {
                reply_markup: { inline_keyboard: buttons }
            });
        } catch (error) {
            this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    }
    
    async executeDeleteRpc(cryptoApp, chatId, rpcKey) {
         try {
             const rpcData = cryptoApp.savedRpcs[rpcKey];
             if (!rpcData) {
                 this.bot.sendMessage(chatId, '❌ RPC tidak ditemukan.');
                 return;
             }
             delete cryptoApp.savedRpcs[rpcKey];
             if (cryptoApp.saveRpcConfig()) {
                this.bot.sendMessage(chatId, `✅ RPC "${rpcData.name}" berhasil dihapus!`);
             }
             this.showRpcMenu(cryptoApp, chatId);
         } catch (error) {
             this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
         }
    }

    async showRpcList(cryptoApp, chatId) {
        try {
            const rpcList = Object.entries(cryptoApp.savedRpcs);
            if (rpcList.length === 0) {
                this.bot.sendMessage(chatId, '📭 Tidak ada RPC tersimpan.');
                return;
            }
            let message = '📡 DAFTAR RPC:\n\n';
            const buttons = [];
            rpcList.forEach(([key, rpc], index) => {
                const isActive = cryptoApp.currentRpc === rpc.rpc;
                message += `${isActive ? '🟢 ' : '⚪️ '}${index + 1}. ${rpc.name}\n`;
                message += `   🔗 ${rpc.rpc}\n`;
                message += `   ⛓️ Chain: ${rpc.chainId}\n\n`;
                buttons.push([
                    { 
                        text: `${isActive ? '🟢 ' : ''}${rpc.name}`, 
                        callback_data: `rpc_use_${key}` 
                    }
                ]);
            });
            buttons.push([{ text: '🔙 Kembali', callback_data: 'rpc_menu' }]);
            this.bot.sendMessage(chatId, message, {
                reply_markup: { inline_keyboard: buttons }
            });
        } catch (error) {
            this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    }

    async selectRpc(cryptoApp, chatId, rpcKey) {
        try {
            const selectedRpc = cryptoApp.savedRpcs[rpcKey];
            if (selectedRpc) {
                cryptoApp.currentRpc = selectedRpc.rpc;
                cryptoApp.currentChainId = selectedRpc.chainId;
                cryptoApp.currentRpcName = selectedRpc.name;
                cryptoApp.setupProvider();
                cryptoApp.saveRpcConfig();
                this.bot.sendMessage(chatId,
                    `✅ RPC DIPILIH!\n\n` +
                    `🏷️ ${selectedRpc.name}\n` +
                    `🔗 ${selectedRpc.rpc}\n` +
                    `⛓️ Chain: ${selectedRpc.chainId}`
                );
            }
        } catch (error) {
            this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    }

    // ===================================
    // INFO & STATUS
    // ===================================
    
    showInfoMenu(cryptoApp, chatId) {
         if (!cryptoApp) return;
         const menu = {
             reply_markup: {
                 inline_keyboard: [
                     [
                         { text: '🤖 Status Bot', callback_data: 'info_status' },
                         { text: '💰 Cek Balance', callback_data: 'wallet_balance' }
                     ],
                     [
                         { text: '📊 TX Stats', callback_data: 'wallet_stats' },
                         { text: 'ℹ️ Info RPC', callback_data: 'rpc_info' }
                     ],
                     [
                         { text: '🔙 Main Menu', callback_data: 'main_menu' }
                     ]
                 ]
             }
         };
         this.bot.sendMessage(chatId, '📊 INFO & STATUS:', menu);
    }

    async checkBalance(cryptoApp, chatId) {
        if (!cryptoApp.wallet) {
            this.bot.sendMessage(chatId, '❌ Belum ada wallet yang dipilih.');
            return;
        }
        try {
            this.bot.sendMessage(chatId, '🔄 Mengecek balance...');
            const balanceInfo = await cryptoApp.checkBalance(); 
            if (balanceInfo) {
                this.bot.sendMessage(chatId,
                    `💰 BALANCE INFO\n\n` +
                    `🏷️ Wallet: ${cryptoApp.wallet.address}\n` + 
                    `💰 Balance: ${balanceInfo.balance} ETH\n` +
                    `📊 Total TX: ${balanceInfo.txCount}\n` +
                    `⛓️ Chain: ${cryptoApp.currentChainId}\n` +
                    `🌐 RPC: ${cryptoApp.currentRpcName}`
                );
            } else {
                 this.bot.sendMessage(chatId, `❌ Gagal mengambil balance.`);
            }
        } catch (error) {
            this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
        }
    }

    async sendBotStatus(chatId) {
        const cryptoApp = this.userSessions.get(chatId);
        if (!cryptoApp) {
            this.bot.sendMessage(chatId, '❌ Sesi Anda tidak ditemukan. /start ulang.');
            return;
        }
        const status = cryptoApp.isConnected ? '🟢 TERHUBUNG' : '🔴 TIDAK TERHUBUNG';
        const walletInfo = cryptoApp.wallet ? 
            `\n💳 Wallet: ${cryptoApp.wallet.address}` : 
            '\n💳 Wallet: Belum setup';
        const wallets = await cryptoApp.loadWallets();
        const totalWallets = Object.keys(wallets).length;
        
        const notifInfo = cryptoApp.sessionNotificationChatId ?
            `\n🔔 Notif ke: ${cryptoApp.sessionNotificationChatId}` :
            '\n🔔 Notif: (dinonaktifkan)';

        this.bot.sendMessage(chatId,
            `🤖 BOT STATUS (Session: ${chatId})\n\n` +
            `Status WC: ${status}` +
            `${walletInfo}\n` +
            `💼 Total Wallets (Anda): ${totalWallets}\n` +
            `${notifInfo}\n` +
            `⛓️ Chain ID: ${cryptoApp.currentChainId}\n` +
            `🌐 RPC: ${cryptoApp.currentRpcName}\n` +
            `⚙️ Auto-Save RPC: ${cryptoApp.autoSaveRpc ? 'ON' : 'OFF'}\n` +
            `⏱️ Smart Delay: ${cryptoApp.executionDelay}s\n` + // [NEW] Info Delay
            `🔑 WC Project: ${this.config.WALLETCONNECT_PROJECT_ID?.slice(0, 8)}...\n\n` +
            `🕒 ${new Date().toLocaleString()}`
        );
    }

    // ===================================
    // MESSAGE & CALLBACK HANDLERS
    // ===================================

    async handleMessage(msg) {
        const chatId = msg.chat.id;
        const text = msg.text;
        if (!text) return;
        
        const userState = this.userStates.get(chatId);
        
        if (!this.userSessions.has(chatId)) {
            if (userState && (userState.action === 'awaiting_admin_password' || userState.action === 'awaiting_script_password')) {
                await this.handlePasswordInput(chatId, text, userState, msg);
                return;
            }
            if (text === '1. Administrator Access' || text === '2. Script Password Access') {
                await this.handleSecurityMessage(chatId, text, msg);
                return;
            }
        }
        
        if (!this.userSessions.has(chatId)) {
            this.bot.sendMessage(chatId, 'Sesi Anda tidak ditemukan. Silakan /start untuk login.');
            return;
        }

        const cryptoApp = this.userSessions.get(chatId);
        if (!cryptoApp) {
             this.bot.sendMessage(chatId, 'Sesi Anda error. Silakan /start ulang.');
             this.userSessions.delete(chatId);
             return;
        }

        if (text === '💼 Wallet Management') {
            this.showWalletMenu(cryptoApp, chatId);
        } else if (text === '📊 Info & Status') {
            this.showInfoMenu(cryptoApp, chatId);
        } else if (text === '🌐 RPC Management') {
            this.showRpcMenu(cryptoApp, chatId);
        } else if (text === '🔗 WalletConnect') {
            this.showWalletConnectMenu(cryptoApp, chatId);
        } else if (text === '🔐 Logout') {
            await this.logout(chatId);
        } else {
            const currentState = this.userStates.get(chatId);
            if (currentState) {
                await this.handleUserState(cryptoApp, chatId, text, currentState, msg);
            }
        }
    }

    async handleSecurityMessage(chatId, text, msg) {
        try { await this.bot.deleteMessage(chatId, msg.message_id); } catch(e) {}
        if (text === '1. Administrator Access') {
            this.userStates.set(chatId, { 
                action: 'awaiting_admin_password',
                loginType: 'admin',
                attempts: 0
            });
            this.bot.sendMessage(chatId,
                `🔐 ADMINISTRATOR LOGIN\n\n` +
                `» Enter administrator password:`
            );
        } else if (text === '2. Script Password Access') {
            this.userStates.set(chatId, { 
                action: 'awaiting_script_password', 
                loginType: 'script',
                attempts: 0
            });
            this.bot.sendMessage(chatId,
                `🔐 SCRIPT LOGIN\n\n` +
                `» Enter script password:`
            );
        }
    }

    async handleUserState(cryptoApp, chatId, text, userState, msg) {
        // [UPDATE V18.2] Handle new gas input states
        if (userState.action === 'awaiting_gas_manual_input' || userState.action === 'awaiting_gas_aggressive_input') {
             await this.processGasInput(cryptoApp, chatId, text, userState, msg);
             return;
        }
        
        try { await this.bot.deleteMessage(chatId, msg.message_id); } catch(e) {}
        switch (userState.action) {
            case 'awaiting_notification_chat_id':
                await this.processNotificationChatId(chatId, text);
                break;
            case 'awaiting_wallet_import':
                await this.processWalletImport(cryptoApp, chatId, text, msg);
                break;
            case 'awaiting_wallet_name':
                await this.processWalletName(cryptoApp, chatId, text);
                break;
            case 'awaiting_wc_uri':
                await this.processWalletConnectURI(cryptoApp, chatId, text, msg);
                break;
            case 'awaiting_rpc_add':
                await this.processAddRpc(cryptoApp, chatId, text, userState);
                break;
            // [BARU V18.3] Handle input delay
            case 'awaiting_delay_input':
                await this.processDelayInput(cryptoApp, chatId, text, msg);
                break;
        }
    }

    async handleCallback(query) {
        const chatId = query.message.chat.id;
        const data = query.data;

        if (!this.userSessions.has(chatId)) {
             this.bot.answerCallbackQuery(query.id, { text: '❌ Sesi berakhir. /start ulang.', show_alert: true });
             return;
        }
        
        const cryptoApp = this.userSessions.get(chatId);
        
        try {
            if (data === 'main_menu') {
                this.showMainMenu(chatId);
            }
            // Wallet management
            else if (data === 'wallet_menu') {
                this.showWalletMenu(cryptoApp, chatId);
            }
            else if (data === 'wallet_import') {
                await this.importWalletFlow(cryptoApp, chatId);
            }
            else if (data === 'wallet_list') {
                await this.listWallets(cryptoApp, chatId, 'wallet_select_');
            }
            else if (data === 'wallet_balance') {
                await this.checkBalance(cryptoApp, chatId);
            }
             else if (data === 'wallet_stats') {
                await this.getTransactionStats(cryptoApp, chatId);
            }
            else if (data.startsWith('wallet_select_')) {
                const address = data.replace('wallet_select_', '');
                await this.selectWallet(cryptoApp, chatId, address);
                this.showWalletMenu(cryptoApp, chatId); 
            }
            else if (data === 'wallet_delete_menu') {
                await this.showDeleteWalletMenu(cryptoApp, chatId);
            }
            else if (data.startsWith('wallet_delete_confirm_')) {
                const address = data.replace('wallet_delete_confirm_', '');
                await this.confirmDeleteWallet(cryptoApp, chatId, address);
            }
             else if (data.startsWith('wallet_delete_exec_')) {
                const address = data.replace('wallet_delete_exec_', '');
                await this.executeDeleteWallet(cryptoApp, chatId, address);
            }
            
            // WalletConnect flow
            else if (data === 'wc_menu') {
                 this.showWalletConnectMenu(cryptoApp, chatId);
            }
            else if (data === 'wc_select_wallet') {
                 await this.listWallets(cryptoApp, chatId, 'wc_wallet_picked_');
            }
             else if (data.startsWith('wc_wallet_picked_')) {
                const address = data.replace('wc_wallet_picked_', '');
                await this.selectWallet(cryptoApp, chatId, address);
                this.showWalletConnectMenu(cryptoApp, chatId);
            }
            else if (data === 'wc_connect') {
                await this.startWalletConnect(cryptoApp, chatId);
            }
            else if (data === 'wc_status') {
                await this.sendBotStatus(chatId);
            }
            else if (data === 'wc_disconnect') {
                await cryptoApp.cleanup();
                this.bot.sendMessage(chatId, '✅ WalletConnect disconnected.');
                this.showWalletConnectMenu(cryptoApp, chatId); 
            }
            // [BARU V18.3] Callback untuk Set Delay
            else if (data === 'wc_set_delay') {
                await this.requestDelayInput(cryptoApp, chatId);
            }
            
            // RPC management
            else if (data === 'rpc_menu') {
                this.showRpcMenu(cryptoApp, chatId);
            }
            else if (data === 'rpc_select') {
                await this.showRpcList(cryptoApp, chatId);
            }
            else if (data === 'rpc_add') {
                await this.startAddRpcFlow(cryptoApp, chatId, 1, {});
            }
             else if (data === 'rpc_info') {
                await this.showRpcInfo(cryptoApp, chatId);
            }
             else if (data === 'rpc_delete_menu') {
                 await this.showDeleteRpcMenu(cryptoApp, chatId);
            }
             else if (data === 'rpc_delete_active') {
                 this.bot.answerCallbackQuery(query.id, { text: '❌ Tidak bisa hapus RPC aktif', show_alert: true });
                 return; 
            }
             else if (data.startsWith('rpc_delete_exec_')) {
                const rpcKey = data.replace('rpc_delete_exec_', '');
                await this.executeDeleteRpc(cryptoApp, chatId, rpcKey);
            }
            else if (data.startsWith('rpc_use_')) {
                const rpcKey = data.replace('rpc_use_', '');
                await this.selectRpc(cryptoApp, chatId, rpcKey);
            }
            else if (data === 'rpc_toggle_autosave') {
                cryptoApp.autoSaveRpc = !cryptoApp.autoSaveRpc;
                cryptoApp.saveRpcConfig();
                const statusText = cryptoApp.autoSaveRpc ? 'AKTIF' : 'NON-AKTIF';
                this.bot.answerCallbackQuery(query.id, { text: `✅ Auto-Save RPC: ${statusText}`, show_alert: false });
                this.showRpcMenu(cryptoApp, chatId);
            }

            // ⛽ GAS MANAGEMENT CALLBACKS [NEW]
            else if (data === 'rpc_gas_menu') {
                await this.showGasRpcSelection(cryptoApp, chatId);
            }
            else if (data.startsWith('rpc_gas_select_')) {
                const rpcKey = data.replace('rpc_gas_select_', '');
                await this.showGasModeSelection(cryptoApp, chatId, rpcKey);
            }
            else if (data.startsWith('rpc_gas_set_auto_')) {
                const rpcKey = data.replace('rpc_gas_set_auto_', '');
                if (cryptoApp.savedRpcs[rpcKey]) {
                    cryptoApp.savedRpcs[rpcKey].gasConfig = { mode: 'auto', value: 0 };
                    cryptoApp.saveRpcConfig();
                    this.bot.answerCallbackQuery(query.id, { text: '✅ Mode: AUTO', show_alert: true });
                    this.showRpcMenu(cryptoApp, chatId);
                }
            }
            else if (data.startsWith('rpc_gas_ask_manual_')) {
                const rpcKey = data.replace('rpc_gas_ask_manual_', '');
                this.userStates.set(chatId, { 
                    action: 'awaiting_gas_manual_input', 
                    tempData: { rpcKey: rpcKey, mode: 'manual' } 
                });
                this.bot.sendMessage(chatId, '🛠 Masukkan nilai Gas (Gwei) yang ingin dipaksa (contoh: 50):', 
                    { reply_markup: { inline_keyboard: [[{ text: '🔙 Batal', callback_data: 'rpc_gas_menu' }]] } }
                );
            }
            else if (data.startsWith('rpc_gas_ask_aggressive_')) {
                const rpcKey = data.replace('rpc_gas_ask_aggressive_', '');
                this.userStates.set(chatId, { 
                    action: 'awaiting_gas_aggressive_input', 
                    tempData: { rpcKey: rpcKey, mode: 'aggressive' } 
                });
                this.bot.sendMessage(chatId, '🚀 Masukkan Persentase Boost (%) (contoh: 20 untuk +20%):',
                    { reply_markup: { inline_keyboard: [[{ text: '🔙 Batal', callback_data: 'rpc_gas_menu' }]] } }
                );
            }
            
            // Info Menu
             else if (data === 'info_menu') {
                 this.showInfoMenu(cryptoApp, chatId);
            }
            else if (data === 'info_status') {
                 await this.sendBotStatus(chatId);
            }

            this.bot.answerCallbackQuery(query.id);
        } catch (error) {
            this.bot.sendMessage(chatId, `❌ Error: ${error.message}`);
            this.bot.answerCallbackQuery(query.id);
        }
    }

    // ===================================
    // UTILITY METHODS
    // ===================================

    async logout(chatId) {
        const cryptoApp = this.userSessions.get(chatId);
        if (cryptoApp) {
            await cryptoApp.cleanup();
        }
        this.userSessions.delete(chatId);
        this.userStates.delete(chatId);
        const menu = { reply_markup: { remove_keyboard: true } };
        this.bot.sendMessage(chatId,
            `🔐 LOGGED OUT\n\n` +
            `Sesi Anda telah berakhir.\n\n` +
            `Kirim /start untuk login kembali.`,
            menu
        );
    }

    async cleanup() {
        if (this.bot) {
            this.bot.stopPolling();
            console.log('🤖 Main Bot stopped.');
        }
        console.log(`Cleaning up ${this.userSessions.size} active sessions...`);
        for (const [chatId, session] of this.userSessions.entries()) {
            console.log(`Cleaning up session for ${chatId}...`);
            await session.cleanup();
        }
        this.userSessions.clear();
        console.log('🤖 All Crypto App sessions cleaned up.');
    }
}

// ===================================
// == MAIN FUNCTION (GABUNGAN)
// ===================================

async function main() {
    const ui = new ModernUI();
    let telegramController = null;

    try {
        await ui.showAnimatedBanner(1, 0);
        const SECURE_CONFIG = loadConfiguration();
        
        if (SECURE_CONFIG.TELEGRAM_BOT_TOKEN) {
            // == MODE TELEGRAM ==
            console.log('🤖 Starting Telegram Bot (V18.3 - Smart Delay)...');
            telegramController = new TelegramFullController(SECURE_CONFIG);
            console.log('✅ Telegram Bot Active!');
            console.log('📱 All features available via Telegram');
            console.log(`🔐 Login via: /start di Bot Anda`);
            
            process.on('SIGINT', async () => {
                console.log('\n👋 Bot stopped by user (Ctrl+C). Cleaning up Telegram Bot...');
                if (telegramController) {
                    await telegramController.cleanup();
                }
                process.exit(0);
            });
            
        } else {
            // == MODE TERMINAL (CLI) ==
            ui.showNotification('warning', 'TOKEN TELEGRAM TIDAK DITEMUKAN', [
                'TELEGRAM_BOT_TOKEN tidak ada di file .env.',
                'Menjalankan mode terminal (CLI)...'
            ]);
            await ui.sleep(2000);
            await runTerminalMode(SECURE_CONFIG);
        }

    } catch (error) {
        ui.stopLoading();
        ui.showNotification('error', 'FATAL APPLICATION ERROR', [error.message, error.stack]);
        console.log(error);
        
        if (telegramController) {
            await telegramController.cleanup();
        }
        
        process.exit(1);
    }
}

// Start the application
main();
