'use client';

import { useEffect, useRef, useState } from 'react';
import { Cloud, Loader2 } from 'lucide-react';
import { desktopBridge, WebDavPublicConfig } from '@/lib/local-session';
import { buildWebDavConfig, syncWebDavSettings } from '@/lib/webdav-settings';

const EMPTY_CONFIG: WebDavPublicConfig = { url: '', username: '', allowInsecureHttp: false, hasPassword: false };

export default function WebDavSettings() {
  const [config, setConfig] = useState(EMPTY_CONFIG);
  const [password, setPassword] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const loadVersion = useRef(0);

  const load = async () => {
    const version = ++loadVersion.current;
    setBusy('load');
    setError('');
    try {
      const bridge = desktopBridge();
      if (!bridge?.getWebDavConfig) throw new Error('当前桌面版本不支持 WebDAV 设置。');
      const saved = await bridge.getWebDavConfig();
      if (version !== loadVersion.current) return;
      setConfig(saved);
      setLoaded(true);
    } catch (failure) {
      if (version === loadVersion.current) setError(failure instanceof Error ? failure.message : '读取 WebDAV 设置失败。');
    } finally {
      if (version === loadVersion.current) setBusy('');
    }
  };

  useEffect(() => {
    void load();
    return () => { loadVersion.current += 1; };
  }, []);

  const update = (changes: Partial<WebDavPublicConfig>) => {
    setConfig((current) => ({ ...current, ...changes }));
    setDirty(true);
    setMessage('');
  };

  const run = async (action: 'save' | 'test' | 'sync') => {
    const bridge = desktopBridge();
    setBusy(action);
    setError('');
    setMessage('');
    try {
      if (!bridge) throw new Error('WebDAV 同步仅在桌面客户端中可用。');
      if (action === 'save') {
        if (!bridge.saveWebDavConfig) throw new Error('当前桌面版本不支持保存 WebDAV 设置。');
        const input = buildWebDavConfig({ url: config.url, username: config.username, allowInsecureHttp: config.allowInsecureHttp }, password);
        setConfig(await bridge.saveWebDavConfig(input));
        setPassword('');
        setDirty(false);
        setMessage('设置已保存。WebDAV 仅在您手动操作时连接。');
      } else if (action === 'test') {
        if (!bridge.testWebDav) throw new Error('当前桌面版本不支持 WebDAV 连接测试。');
        await bridge.testWebDav();
        setMessage('连接测试成功。');
      } else {
        await syncWebDavSettings(bridge);
        setMessage('同步成功，本地收藏与进度已刷新。');
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'WebDAV 操作失败，请重试。');
    } finally {
      setBusy('');
    }
  };

  const inputClass = 'mt-2 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-textPrimary outline-none focus:border-primary disabled:opacity-50';
  const buttonClass = 'rounded-xl border border-border bg-surfaceLight px-3 py-2 text-xs font-semibold text-textPrimary hover:bg-surface disabled:opacity-50';

  return (
    <section className="rounded-2xl bg-surface border border-border p-6 mb-6">
      <h2 className="text-sm font-bold text-textSecondary uppercase tracking-wider mb-4 flex items-center">
        <Cloud className="h-4 w-4 mr-2" />可选 WebDAV 同步
      </h2>
      <p className="mb-5 text-xs text-textSecondary">配置自己的网盘或 NAS，手动同步收藏和最近进度。未配置时，资料仍保存在此设备。</p>
      {loaded ? (
        <div className="space-y-4">
          <label className="block text-sm text-textPrimary">
            服务器地址
            <input type="url" value={config.url} onChange={(event) => update({ url: event.target.value })} disabled={Boolean(busy)} placeholder="https://dav.example.com/Titanhub/" autoComplete="off" className={inputClass} />
          </label>
          <label className="block text-sm text-textPrimary">
            用户名
            <input value={config.username} onChange={(event) => update({ username: event.target.value })} disabled={Boolean(busy)} autoComplete="off" className={inputClass} />
          </label>
          <label className="block text-sm text-textPrimary">
            密码
            <input type="password" value={password} onChange={(event) => { setPassword(event.target.value); setDirty(true); setMessage(''); }} disabled={Boolean(busy)} autoComplete="new-password" placeholder={config.hasPassword ? '已保存密码；当前地址和账号不变时留空保留' : '请输入 WebDAV 密码'} className={inputClass} />
            <span className="mt-1 block text-xs text-textSecondary">{config.hasPassword ? '密码不会回显。当前地址和账号不变时留空保留密码；更换后须重新输入。' : '密码只交由桌面客户端安全保存。'}</span>
          </label>
          <label className="flex items-start gap-2 text-xs text-textSecondary">
            <input type="checkbox" checked={config.allowInsecureHttp} onChange={(event) => update({ allowInsecureHttp: event.target.checked })} disabled={Boolean(busy)} className="mt-0.5 accent-primary" />
            允许 HTTP 不加密连接（用户名和密码可能被明文传输）
          </label>
          {dirty && <p className="text-xs text-textSecondary">请先保存修改，再测试连接或同步。</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={Boolean(busy)} onClick={() => void run('save')} className={buttonClass}>{busy === 'save' ? '正在保存…' : '保存设置'}</button>
            <button type="button" disabled={Boolean(busy) || dirty || !config.url} onClick={() => void run('test')} className={buttonClass}>{busy === 'test' ? '正在测试…' : '测试连接'}</button>
            <button type="button" disabled={Boolean(busy) || dirty || !config.url} onClick={() => void run('sync')} className={buttonClass}>{busy === 'sync' ? '正在同步…' : '立即同步'}</button>
          </div>
        </div>
      ) : busy ? (
        <p className="flex items-center text-sm text-textSecondary"><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在读取设置…</p>
      ) : (
        <button type="button" onClick={() => void load()} className={buttonClass}>重试读取设置</button>
      )}
      {error && <p role="alert" className="mt-4 text-sm text-rose-400">{error}</p>}
      {message && <p role="status" className="mt-4 text-sm text-primary">{message}</p>}
    </section>
  );
}
