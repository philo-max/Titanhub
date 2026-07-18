'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Blocks,
  Loader2,
  Power,
  Trash2,
  Upload,
  Search,
  DownloadCloud,
  Check,
  Layers,
  RefreshCw,
  Globe
} from 'lucide-react';
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

interface MarketPlugin {
  id: string;
  name: string;
  version: string;
  type: 'anime' | 'manga' | 'novel' | 'movie';
  sourceType: 'kazumi' | 'lnreader' | 'venera';
  downloadUrl: string;
  description?: string;
  lang?: string;
}

export default function PluginMarketPage() {
  const token = useAuthStore((s) => s.token);
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  // Manual installation settings
  const [mode, setMode] = useState<'js' | 'kazumi' | 'venera'>('js');
  const [installId, setInstallId] = useState('');
  const [installName, setInstallName] = useState('');
  const [installTypes, setInstallTypes] = useState('anime');
  const [installSource, setInstallSource] = useState('');

  // Online marketplace state
  const [marketSources, setMarketSources] = useState<MarketPlugin[]>([]);
  const [marketLoading, setMarketLoading] = useState(true);
  const [installingId, setInstallingId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<'market' | 'installed' | 'custom'>('market');

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

  const fetchMarket = useCallback(async () => {
    setMarketLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/market/sources`);
      const data = await res.json();
      setMarketSources(data.sources || []);
    } catch {
      // Graceful fallback if market api fails
      console.error('Failed to fetch marketplace plugins.');
    } finally {
      setMarketLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    fetchMarket();
  }, [refresh, fetchMarket]);

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

  // Manual code install
  const installCustom = async (e: React.FormEvent) => {
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

  // Market One-Click Install
  const installFromMarket = async (src: MarketPlugin) => {
    if (!token) {
      setMessage('安装插件需要先登录，请在右上角菜单进行登录。');
      return;
    }
    setInstallingId(src.id);
    setMessage('');
    try {
      const res = await fetch(`${API_BASE}/api/market/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(src),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setMessage(`🎉 插件「${src.name.replace(/\s*\(\w+\)$/i, '')}」一键安装并适配成功！`);
      await refresh();
    } catch (err: any) {
      setMessage(err.message || '安装失败，请检查后端网络与日志。');
    } finally {
      setInstallingId('');
    }
  };

  // Local filtering for market sources
  const filteredMarket = marketSources.filter((src) => {
    const matchesSearch =
      src.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      src.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (src.description && src.description.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (src.lang && src.lang.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesType =
      selectedType === 'all' ||
      (selectedType === 'anime' && (src.type === 'anime' || src.type === 'movie')) ||
      (selectedType === 'manga' && src.type === 'manga') ||
      (selectedType === 'novel' && src.type === 'novel');

    return matchesSearch && matchesType;
  });

  return (
    <div className="min-h-screen bg-background text-textPrimary pb-24">
      <div className="max-w-5xl mx-auto px-6 pt-12">
        <Link
          href="/"
          className="inline-flex items-center space-x-2 text-textSecondary hover:text-textPrimary transition mb-10 group"
        >
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-1 transition-transform" />
          <span className="text-sm font-medium">返回发现</span>
        </Link>

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight flex items-center bg-gradient-to-r from-primary to-purple-400 bg-clip-text text-transparent">
              <Blocks className="h-7 w-7 text-primary mr-3" />
              插件中央市场
            </h1>
            <p className="text-sm text-textSecondary mt-1">
              通过 WebAssembly 沙箱安全执行解析，一键装配海量开源动漫、漫画和轻小说聚合源。
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!token && (
              <span className="text-xs px-3 py-1.5 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20">
                🔒 登录后解锁一键安装与管理
              </span>
            )}
          </div>
        </div>

        {message && (
          <div className="mb-6 px-4 py-3 rounded-xl bg-surface border border-border text-sm text-textPrimary flex items-center justify-between shadow-lg shadow-black/5 animate-fade-in">
            <span>{message}</span>
            <button onClick={() => setMessage('')} className="text-xs text-textSecondary hover:text-textPrimary ml-3 font-semibold">
              忽略
            </button>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="flex border-b border-border/80 mb-8 gap-1 p-1 bg-surface/20 rounded-xl max-w-md">
          <button
            onClick={() => setActiveTab('market')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'market' ? 'bg-surfaceLight text-primary shadow-sm border border-border' : 'text-textSecondary hover:text-textPrimary'}`}
          >
            <Globe className="h-3.5 w-3.5" />
            公共源市场 ({marketSources.length})
          </button>
          <button
            onClick={() => setActiveTab('installed')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'installed' ? 'bg-surfaceLight text-primary shadow-sm border border-border' : 'text-textSecondary hover:text-textPrimary'}`}
          >
            <Layers className="h-3.5 w-3.5" />
            已安装 ({plugins.length})
          </button>
          <button
            onClick={() => setActiveTab('custom')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'custom' ? 'bg-surfaceLight text-primary shadow-sm border border-border' : 'text-textSecondary hover:text-textPrimary'}`}
          >
            <Upload className="h-3.5 w-3.5" />
            手动导入
          </button>
        </div>

        {/* Tab 1: Marketplace */}
        {activeTab === 'market' && (
          <section className="space-y-6">
            <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
              {/* Search & Category filter */}
              <div className="relative w-full sm:max-w-md">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-textSecondary" />
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索公共源 (支持搜索名字, ID, 语言或描述)..."
                  className="w-full bg-surface border border-border/80 rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none focus:border-primary/50 transition-colors shadow-inner"
                />
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <div className="flex bg-surface/50 border border-border/80 rounded-xl p-1 gap-1 text-xs">
                  {[
                    { key: 'all', label: '全部' },
                    { key: 'anime', label: '动漫视频' },
                    { key: 'manga', label: '漫画' },
                    { key: 'novel', label: '轻小说' },
                  ].map((filter) => (
                    <button
                      key={filter.key}
                      onClick={() => setSelectedType(filter.key)}
                      className={`px-3 py-1.5 rounded-lg font-semibold transition ${selectedType === filter.key ? 'bg-surfaceLight text-primary border border-border/40 font-bold' : 'text-textSecondary hover:text-textPrimary'}`}
                    >
                      {filter.label}
                    </button>
                  ))}
                </div>

                <button
                  onClick={fetchMarket}
                  disabled={marketLoading}
                  title="刷新市场数据"
                  className="p-2.5 rounded-xl bg-surface/50 border border-border/80 hover:bg-surfaceLight text-textSecondary hover:text-textPrimary transition disabled:opacity-50"
                >
                  <RefreshCw className={`h-4 w-4 ${marketLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {marketLoading ? (
              <div className="flex flex-col items-center justify-center py-24 text-textSecondary gap-3 bg-surface/10 rounded-3xl border border-border/40 border-dashed">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <span className="text-sm font-medium">正在拉取 GitHub 开源聚合源市场列表...</span>
              </div>
            ) : filteredMarket.length === 0 ? (
              <div className="text-center py-20 text-textSecondary text-sm border border-border rounded-3xl bg-surface/20">
                没有找到符合筛选条件的公共源。
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredMarket.map((src) => {
                  const isInstalled = plugins.some((p) => p.id === src.id);
                  const isInstalling = installingId === src.id;

                  // Determine colored bullet by plugin type
                  let typeColor = 'bg-indigo-500';
                  let typeLabel = '动漫';
                  if (src.type === 'manga') {
                    typeColor = 'bg-orange-500';
                    typeLabel = '漫画';
                  } else if (src.type === 'novel') {
                    typeColor = 'bg-emerald-500';
                    typeLabel = '小说';
                  } else if (src.type === 'movie') {
                    typeColor = 'bg-purple-500';
                    typeLabel = '电影';
                  }

                  // Platform label style
                  let platformStyle = 'bg-purple-500/10 text-purple-400 border border-purple-500/20';
                  if (src.sourceType === 'lnreader') {
                    platformStyle = 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
                  } else if (src.sourceType === 'venera') {
                    platformStyle = 'bg-orange-500/10 text-orange-400 border border-orange-500/20';
                  }

                  return (
                    <div
                      key={src.id}
                      className="group flex flex-col justify-between p-5 rounded-2xl bg-surface/40 hover:bg-surface/75 border border-border/80 hover:border-primary/40 transition-all duration-300 shadow-md hover:shadow-lg hover:shadow-black/5"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2">
                            <span className={`w-2.5 h-2.5 rounded-full ${typeColor}`} />
                            <span className="text-xs font-bold text-textSecondary">{typeLabel}</span>
                          </div>
                          <div className="flex gap-1.5">
                            {src.lang && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-surfaceLight text-textSecondary border border-border">
                                {src.lang}
                              </span>
                            )}
                            <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${platformStyle}`}>
                              {src.sourceType}
                            </span>
                          </div>
                        </div>

                        <h3 className="text-base font-bold truncate group-hover:text-primary transition-colors">
                          {src.name.replace(/\s*\(\w+\)$/i, '')}
                        </h3>
                        <p className="text-xs text-textSecondary mt-1 leading-relaxed line-clamp-2 min-h-[2rem]">
                          {src.description || '暂无描述。'}
                        </p>
                      </div>

                      <div className="flex items-center justify-between border-t border-border/60 pt-4 mt-4 text-xs">
                        <span className="text-textSecondary font-mono font-medium">版本: v{src.version}</span>
                        {isInstalled ? (
                          <div className="flex gap-2">
                            <span className="flex items-center gap-1 text-emerald-400 font-semibold px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 select-none">
                              <Check className="h-3.5 w-3.5" />
                              已启用
                            </span>
                            {token && (
                              <button
                                onClick={() => installFromMarket(src)}
                                disabled={!!installingId}
                                className="text-textSecondary hover:text-textPrimary font-semibold px-3 py-1.5 rounded-xl bg-surfaceLight border border-border transition hover:bg-surface/80"
                              >
                                重装
                              </button>
                            )}
                          </div>
                        ) : (
                          <button
                            onClick={() => installFromMarket(src)}
                            disabled={!token || !!installingId}
                            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-white font-bold transition-all shadow-md shadow-primary/10 ${token ? 'bg-primary hover:opacity-90 hover:scale-[1.02] active:scale-[0.98]' : 'bg-surfaceLight text-textSecondary border border-border cursor-not-allowed opacity-50'}`}
                          >
                            {isInstalling ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                正在装配...
                              </>
                            ) : (
                              <>
                                <DownloadCloud className="h-3.5 w-3.5" />
                                一键装配
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* Tab 2: Installed Plugins */}
        {activeTab === 'installed' && (
          <section className="space-y-4">
            <h2 className="text-sm font-bold text-textSecondary uppercase tracking-wider mb-2">
              已挂载沙箱插件 ({plugins.length})
            </h2>
            {loading ? (
              <div className="flex items-center justify-center py-16 text-textSecondary">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                <span className="text-sm">加载插件列表...</span>
              </div>
            ) : plugins.length === 0 ? (
              <div className="text-center py-12 text-textSecondary text-sm border border-border rounded-2xl bg-surface/40">
                尚未安装任何插件，前往「公共源市场」一键装载。
              </div>
            ) : (
              <div className="space-y-3">
                {plugins.map((plugin) => (
                  <div
                    key={plugin.id}
                    className={`flex items-center justify-between gap-4 p-4 rounded-2xl bg-surface border transition-all ${plugin.isActive ? 'border-border' : 'border-border/40 opacity-60'}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
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
                      <p className="text-xs text-textSecondary mt-1.5 truncate">
                        ID: <code className="font-mono bg-background/50 px-1 py-0.5 rounded">{plugin.id}</code> · 
                        支持类型: <span className="font-semibold text-textPrimary">{plugin.types.join(', ')}</span>
                      </p>
                    </div>
                    {token && (
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() => toggleActive(plugin)}
                          disabled={busy === plugin.id}
                          title={plugin.isActive ? '停用' : '启用'}
                          className={`p-2 rounded-xl border transition-all ${plugin.isActive ? 'text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/10' : 'text-textSecondary border-border hover:bg-surfaceLight'}`}
                        >
                          <Power className="h-4.5 w-4.5" />
                        </button>
                        <button
                          onClick={() => removePlugin(plugin)}
                          disabled={busy === plugin.id}
                          title="卸载"
                          className="p-2 rounded-xl text-rose-500 border border-rose-500/20 hover:bg-rose-500/10 transition-all"
                        >
                          <Trash2 className="h-4.5 w-4.5" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Tab 3: Custom Import */}
        {activeTab === 'custom' && (
          <section className="rounded-3xl bg-surface/50 border border-border p-6 backdrop-blur-md shadow-xl">
            <h2 className="text-sm font-bold text-textSecondary uppercase tracking-wider mb-4 flex items-center">
              <Upload className="h-4 w-4 mr-2 text-primary" />
              手动导入源规则 (开发者模式)
            </h2>

            <div className="flex gap-2 mb-6">
              {[
                { key: 'js', label: 'Titanhub JS 插件' },
                { key: 'kazumi', label: 'Kazumi 规则 (JSON)' },
                { key: 'venera', label: 'Venera 规则 (JS)' },
              ].map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setMode(m.key as any)}
                  className={`text-xs font-semibold px-3 py-2 rounded-lg border transition ${mode === m.key ? 'bg-primary/10 text-primary border-primary/30 font-bold' : 'text-textSecondary border-border hover:bg-surfaceLight'}`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {token ? (
              <form onSubmit={installCustom} className="space-y-4">
                {(mode === 'js' || mode === 'venera') && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <input
                      value={installId}
                      onChange={(e) => setInstallId(e.target.value)}
                      placeholder="插件 ID (如 my-custom-source)"
                      className="bg-background border border-border rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-primary/50 transition"
                    />
                    <input
                      value={installName}
                      onChange={(e) => setInstallName(e.target.value)}
                      placeholder="插件显示名称"
                      className="bg-background border border-border rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-primary/50 transition"
                    />
                    {mode === 'js' ? (
                      <input
                        value={installTypes}
                        onChange={(e) => setInstallTypes(e.target.value)}
                        placeholder="源类型 (如 anime,manga,novel)"
                        className="bg-background border border-border rounded-xl px-3.5 py-2.5 text-sm outline-none focus:border-primary/50 transition"
                      />
                    ) : (
                      <div className="bg-background/40 border border-border/60 rounded-xl px-3.5 py-2.5 text-sm text-textSecondary flex items-center select-none">
                        类型自动锁定为: manga
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
                        ? '粘贴 Kazumi 规则的 JSON 字符串...'
                        : '粘贴 Venera JS 源码（插件类型自动判定为 manga）...'
                  }
                  rows={10}
                  className="w-full bg-background border border-border rounded-2xl px-4 py-3.5 text-xs font-mono outline-none focus:border-primary/50 resize-y focus:ring-1 focus:ring-primary/20 shadow-inner"
                />
                <button
                  type="submit"
                  disabled={busy === 'install' || !installSource.trim()}
                  className="flex items-center text-sm font-semibold px-6 py-3 rounded-xl bg-primary text-white hover:opacity-90 disabled:opacity-40 hover:scale-[1.01] active:scale-[0.99] transition shadow-md shadow-primary/10"
                >
                  {busy === 'install' && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  部署到沙箱
                </button>
              </form>
            ) : (
              <div className="text-center py-10 bg-background/30 rounded-2xl border border-border text-sm text-textSecondary">
                🔒 请先在右上角菜单登录以导入和部署自定义插件。
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
