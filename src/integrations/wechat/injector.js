const { spawn } = require('node:child_process');
const logger = require('../../utils/logger');

class WeChatInjector {
  constructor(config) { this.config = config; }
  async enqueue(outboundId) {
    if (!this.config.injectEnabled) return { queued: false, reason: 'disabled' };
    const args = [...this.config.executableArgs, 'inject', '--instance', this.config.instance, '--text', `[GYM_DELIVER:${outboundId}]`];
    return new Promise((resolve, reject) => {
      const child = spawn(this.config.executable, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve({ queued: true });
        else {
          logger.warn('wechat.inject.failed', { outbound_id: outboundId, exit_code: code, stderr: stderr.slice(0, 300) });
          reject(new Error(`wechat-acp inject exited ${code}`));
        }
      });
    });
  }
}
module.exports = { WeChatInjector };
