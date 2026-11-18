export function sourceFailure(error: unknown): { code: string; status: 'error' | 'timeout' | 'unsupported' | 'configuration_required'; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (/CONFIG_REQUIRED/i.test(message)) return { code: 'CONFIG_REQUIRED', status: 'configuration_required', message: '此来源需要先配置服务器或账号，当前客户端尚未提供完整来源设置。' };
  if (/HOME_UNSUPPORTED|Method 'explore' is not defined/i.test(message)) return { code: 'HOME_UNSUPPORTED', status: 'unsupported', message: '该来源暂不支持首页推荐，可尝试搜索。' };
  if (/SOURCE_CAPABILITY_UNSUPPORTED|does not support Venera|unsupported.*(?:Cookie|setting|login|interactive|binary)/i.test(message)) return { code: 'CAPABILITY_UNSUPPORTED', status: 'unsupported', message: '此来源需要当前客户端尚未支持的功能，可能涉及登录、设置或图片处理。' };
  if (/timed out|timeout|interrupted|execution.*budget/i.test(message)) return { code: 'TIMEOUT', status: 'timeout', message: '来源请求或脚本执行超时，请稍后重试。' };
  const http = /\b(?:HTTP|status(?: code)?)[:\s]*(\d{3})\b/i.exec(message);
  if (http) {
    const status = Number(http[1]);
    const reason = status === 401 ? '来源需要登录或授权' : status === 403 ? '来源拒绝访问，可能需要登录或站点验证' : status === 429 ? '来源请求过于频繁，请稍后重试' : status >= 500 ? '来源服务器暂时异常' : '来源请求失败';
    return { code: `HTTP_${status}`, status: 'error', message: `${reason}（HTTP ${status}）。` };
  }
  if (/Public DNS|NXDOMAIN|ENOTFOUND|EAI_AGAIN|DNS.*(?:failed|invalid|error)/i.test(message)) return { code: 'DNS_ERROR', status: 'error', message: '来源域名暂时无法解析，请稍后重试或更换来源。' };
  if (/SecurityError|sandbox policy|Fake-IP/i.test(message)) return { code: 'NETWORK_POLICY', status: 'error', message: '来源地址未通过网络校验，不允许访问非公开地址；私服请先检查配置。' };
  if (/filename|wasm|QuickJS|runtime initialization/i.test(message)) return { code: 'ENGINE_ERROR', status: 'error', message: '来源引擎初始化失败，请升级客户端。' };
  if (/fetch|network|ECONN|TLS/i.test(message)) return { code: 'NETWORK_ERROR', status: 'error', message: '来源网络请求失败，请稍后重试或更换来源。' };
  return { code: 'PARSE_ERROR', status: 'error', message: '来源响应无法解析。' };
}
