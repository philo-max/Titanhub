'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Blocks, Loader2, Power, Trash2, Upload } from 'lucide-react';
import { adaptKazumi, adaptVenera } from '@titanhub/plugin-adapter';
import { useAuthStore } from '@/stores/authStore';
import { API_BASE } from '@/lib/config';

interface PluginInfo {
  id: string;
  name: string;
  version: string;
  types: string[];
  author?: string;
  isBuiltin?: boolean;
  isActive: boolean;
}

export default function PluginMarketPage() {
  const token = useAuthStore((s) => s.token);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  const [mode, setMode] = useState<'js' | 'kazumi' | 'venera'>('js');
  const [installId, setInstallId] = useState('');
  const [installName, setInstallName] = useState('');
  const [installTypes, setInstallTypes] = useState('anime');
  const [installSource, setInstallSource] = useState('');

  const authHeaders = useCallback(
    (): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {}),
    [token]
  );

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/plugins`);
      const data = await res.json();
      setPlugins(data.plugins || []);
    } catch {
      setMessage('无法连接到服务器，请确认后端正在运行。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggleActive = async (plugin: PluginInfo) => {
    setBusy(plugin.id);
    try {
      const res = await fetch(`${API_BASE}/api/plugins/${plugin.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ isActive: !plugin.isActive }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      await refresh();
    } catch (e: any) {
      setMessage(e.message || '操作失败');
    } finally {
      setBusy('');
    }
  };

  const removePlugin = async (plugin: PluginInfo) => {
    if (!window.confirm(`确定卸载插件「${plugin.name}」？`)) return;
    setBusy(plugin.id);
    try {
      const res = await fetch(`${API_BASE}/api/plugins/${plugin.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      await refresh();
    } catch (e: any) {
      setMessage(e.message || '卸载失败');
    } finally {
      setBusy('');
    }
  };

  const install = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');
    setBusy('install');
    try {
      let payload: { id: string; name: string; version?: string; types: string[]; code: string };

      if (mode === 'kazumi') {
        const rule = JSON.parse(installSource);
        const adapted = adaptKazumi(rule);
        payload = adapted;
      } else if (mode === 'venera') {
        if (!installId.trim() || !installName.trim() || !installSource.trim()) {
          throw new Error('请填写插件 ID、名称和 Venera 源码。');
        }
        const adapted = adaptVenera(installSource, {
          id: installId.trim(),
          name: installName.trim(),
        });
        payload = adapted;
      } else {
        if (!installId.trim() || !installName.trim() || !installSource.trim()) {
          throw new Error('请填写插件 ID、名称和源码。');
        }
        payload = {
          id: installId.trim(),
          name: installName.trim(),
          types: installTypes
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          code: installSource,
        };
      }

      const res = await fetch(`${API_BASE}/api/plugins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setMessage(`插件「${payload.name}」安装成功。`);
      setInstallId('');
      setInstallName('');
      setInstallSource('');
      await refresh();
    } catch (err: any) {
      setMessage(err.message || '安装失败');
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="min-h-screen bg-background text-textPrimary pb-24">
      <div className="max-w-4xl mx-auto px-6 pt-12">
        <Link
          href="/"
          className="inline-flex items-center space-x-2 text-textSecondary hover:text-textPrimary transition mb-10 group"
        >
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
          <span className="text-sm font-medium">返回发现</span>
        </Link>

        <h1 className="text-2xl font-extrabold tracking-tight mb-2 flex items-center">
          <Blocks className="h-6 w-6 text-primary mr-3" />
          插件市场
        </h1>
        <p className="text-sm text-textSecondary mb-8">
          插件在服务端 WebAssembly 沙箱中隔离执行。{!token && '安装、启停和卸载需要先登录。'}
        </p>

        {message && (
          <div className="mb-6 px-4 py-3 rounded-xl bg-surface border border-border text-sm text-textPrimary">
            {message}
          </div>
        )}

        <section className="mb-12">
          <h2 className="text-sm font-bold text-textSecondary uppercase tracking-wider mb-4">
            已安装插件
          </h2>
          {loading ? (
            <div className="flex items-center justify-center py-16 text-textSecondary">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <span className="text-sm">加载插件列表...</span>
            </div>
          ) : plugins.length === 0 ? (
            <div className="text-center py-12 text-textSecondary text-sm border border-border rounded-2xl bg-surface/40">
              尚未安装任何插件。
            </div>
          ) : (
            <div className="space-y-3">
              {plugins.map((plugin) => (
                <div
                  key={plugin.id}
                  className={`flex items-center gap-4 p-4 rounded-2xl bg-surface border transition ${plugin.isActive ? 'border-border' : 'border-border opacity-60'}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold truncate">{plugin.name}</p>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-surfaceLight text-textSecondary border border-border flex-shrink-0">
                        v{plugin.version}
                      </span>
                      {plugin.isBuiltin && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 flex-shrink-0">
                          内置
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-textSecondary mt-1 truncate">
                      {plugin.id} · 类型: {plugin.types.join(', ') || '未知'}
                    </p>
                  </div>
                  {token && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => toggleActive(plugin)}
                        disabled={busy === plugin.id}
                        title={plugin.isActive ? '停用' : '启用'}
                        className={`p-2 rounded-xl border transition ${plugin.isActive ? 'text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/10' : 'text-textSecondary border-border hover:bg-surfaceLight'}`}
                      >
                        <Power className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => removePlugin(plugin)}
                        disabled={busy === plugin.id}
                        title="卸载"
                        className="p-2 rounded-xl text-rose-500 border border-rose-500/20 hover:bg-rose-500/10 transition"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {token && (
          <section className="rounded-2xl bg-surface border border-border p-6">
            <h2 className="text-sm font-bold text-textSecondary uppercase tracking-wider mb-4 flex items-center">
              <Upload className="h-4 w-4 mr-2" />
              安装新插件
            </h2>

            <div className="flex gap-2 mb-4">
              <button
                type="button"
                onClick={() => setMode('js')}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition ${mode === 'js' ? 'bg-primary/10 text-primary border-primary/30' : 'text-textSecondary border-border hover:bg-surfaceLight'}`}
              >
                Titanhub JS 插件
              </button>
              <button
                type="button"
                onClick={() => setMode('kazumi')}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition ${mode === 'kazumi' ? 'bg-primary/10 text-primary border-primary/30' : 'text-textSecondary border-border hover:bg-surfaceLight'}`}
              >
                导入 Kazumi 规则 (JSON)
              </button>
              <button
                type="button"
                onClick={() => setMode('venera')}
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition ${mode === 'venera' ? 'bg-primary/10 text-primary border-primary/30' : 'text-textSecondary border-border hover:bg-surfaceLight'}`}
              >
                导入 Venera 规则 (JS)
              </button>
            </div>

            <form onSubmit={install} className="space-y-3">
              {(mode === 'js' || mode === 'venera') && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <input
                    value={installId}
                    onChange={(e) => setInstallId(e.target.value)}
                    placeholder="插件 ID（如 my-source）"
                    className="bg-background border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary/50"
                  />
                  <input
                    value={installName}
                    onChange={(e) => setInstallName(e.target.value)}
                    placeholder="插件名称"
                    className="bg-background border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary/50"
                  />
                  {mode === 'js' ? (
                    <input
                      value={installTypes}
                      onChange={(e) => setInstallTypes(e.target.value)}
                      placeholder="类型（如 anime,manga）"
                      className="bg-background border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary/50"
                    />
                  ) : (
                    <div className="bg-background/40 border border-border/60 rounded-xl px-3 py-2 text-sm text-textSecondary flex items-center select-none">
                      类型已自动锁定为: manga
                    </div>
                  )}
                </div>
              )}
              <textarea
                value={installSource}
                onChange={(e) => setInstallSource(e.target.value)}
                placeholder={
                  mode === 'js'
                    ? '粘贴插件 JS 源码（需设置 globalThis.plugin）...'
                    : mode === 'kazumi'
                      ? '粘贴 Kazumi JSON 规则...'
                      : '粘贴 Venera JS 源码（支持对象或 class 式源，插件类型自动判定为 manga）...'
                }
                rows={8}
                className="w-full bg-background border border-border rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-primary/50 resize-y"
              />
              <button
                type="submit"
                disabled={busy === 'install' || !installSource.trim()}
                className="flex items-center text-sm font-semibold px-5 py-2.5 rounded-xl bg-primary text-white hover:opacity-90 disabled:opacity-40 transition"
              >
                {busy === 'install' && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                安装插件
              </button>
            </form>
          </section>
        )}
      </div>
    </div>
  );
}
