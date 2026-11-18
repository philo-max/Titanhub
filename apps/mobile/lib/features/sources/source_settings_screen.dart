import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/sandbox/local_plugin_runner.dart';
import '../../core/sources/local_sources.dart';
import '../../core/sources/venera/venera_source.dart';
import '../../core/theme/app_theme.dart';
import 'source_config_panels.dart';

const double _maxContentWidth = 640;
const Set<String> supportedSettingTypes = {'input', 'select', 'switch'};

final settingsSourceProvider = Provider.family<VeneraSource?, String>(
  (ref, id) => ref.read(localPluginRunnerProvider).veneraSource(id),
);

class SourceSettingsScreen extends ConsumerStatefulWidget {
  const SourceSettingsScreen({super.key, required this.pluginId});

  final String pluginId;

  @override
  ConsumerState<SourceSettingsScreen> createState() => _SourceSettingsScreenState();
}

class _SourceSettingsScreenState extends ConsumerState<SourceSettingsScreen> {
  final _userController = TextEditingController();
  final _passwordController = TextEditingController();
  final Map<String, Object?> _edits = {};
  final Map<String, TextEditingController> _inputs = {};
  late Future<VeneraSourceInfo> _info;
  String? _message;
  bool _messageIsError = false;
  bool _working = false;

  VeneraSource? get _source => ref.read(settingsSourceProvider(widget.pluginId));

  @override
  void initState() {
    super.initState();
    _info = _loadInfo();
  }

  @override
  void dispose() {
    _userController.dispose();
    _passwordController.dispose();
    for (final controller in _inputs.values) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<VeneraSourceInfo> _loadInfo() {
    final source = _source;
    if (source == null) return Future.error('来源未安装或未启用运行时');
    return source.info();
  }

  void _reload() {
    _edits.clear();
    for (final controller in _inputs.values) {
      controller.dispose();
    }
    _inputs.clear();
    setState(() {
      _info = _loadInfo();
    });
  }

  Future<void> _run(Future<void> Function(VeneraSource source) action, String success) async {
    final source = _source;
    if (source == null || _working) return;
    setState(() {
      _working = true;
      _message = null;
    });
    try {
      await action(source);
      _message = success;
      _messageIsError = false;
    } catch (error) {
      _message = '$error';
      _messageIsError = true;
    }
    if (!mounted) return;
    _working = false;
    _reload();
  }

  Future<void> _save() => _run((source) async {
        for (final entry in _edits.entries) {
          await source.saveSetting(entry.key, entry.value);
        }
      }, '设置已保存');

  Future<void> _login() => _run((source) async {
        await source.login(_userController.text.trim(), _passwordController.text);
        _passwordController.clear();
      }, '登录成功');

  Future<void> _logout() => _run((source) => source.logout(), '已退出登录');

  @override
  Widget build(BuildContext context) {
    final name = ref.watch(sourceByIdProvider(widget.pluginId))?.name ?? '来源';
    return Scaffold(
      appBar: AppBar(title: Text('$name 设置')),
      body: Align(
        alignment: Alignment.topCenter,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: _maxContentWidth),
          child: FutureBuilder<VeneraSourceInfo>(
            future: _info,
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) {
                return const Center(child: CircularProgressIndicator());
              }
              if (snapshot.hasError) {
                return ListView(
                  padding: const EdgeInsets.all(16),
                  children: [SourceNotice('无法读取来源设置：${snapshot.error}', AppTheme.danger)],
                );
              }
              return _buildBody(snapshot.data!);
            },
          ),
        ),
      ),
    );
  }

  Widget _buildBody(VeneraSourceInfo info) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (_message != null)
          SourceNotice(_message!, _messageIsError ? AppTheme.danger : AppTheme.success),
        if (info.settings.isEmpty && !_hasLogin(info))
          const SourceNotice('这个来源没有可配置的设置项。', AppTheme.textSecondary),
        if (info.settings.isNotEmpty) _buildSettings(info),
        if (_hasLogin(info)) _buildLogin(info),
      ],
    );
  }

  bool _hasLogin(VeneraSourceInfo info) =>
      info.canPasswordLogin || info.hasWebLogin || info.hasCookieLogin;

  TextEditingController _inputFor(VeneraSettingItem item) => _inputs.putIfAbsent(
        item.key,
        () => TextEditingController(text: '${item.value ?? ''}'),
      );

  Widget _buildSettings(VeneraSourceInfo info) {
    return Container(
      margin: const EdgeInsets.only(top: 12),
      padding: const EdgeInsets.all(16),
      decoration: panelDecoration(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('来源设置',
              style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13)),
          for (final item in info.settings) _settingField(item),
          const SizedBox(height: 12),
          FilledButton(
            key: const Key('settings-save'),
            onPressed: _working || _edits.isEmpty ? null : _save,
            child: const Text('保存设置'),
          ),
        ],
      ),
    );
  }

  Widget _settingField(VeneraSettingItem item) {
    final label = Text(item.title, style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12));
    switch (item.type) {
      case 'input':
        return Padding(
          padding: const EdgeInsets.only(top: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              label,
              TextField(
                key: Key('setting-${item.key}'),
                controller: _inputFor(item),
                style: const TextStyle(color: Colors.white, fontSize: 13),
                onChanged: (value) => setState(() => _edits[item.key] = value),
              ),
            ],
          ),
        );
      case 'switch':
        final value = _edits.containsKey(item.key) ? _edits[item.key] == true : item.value == true;
        return Row(
          children: [
            Expanded(child: Padding(padding: const EdgeInsets.only(top: 12), child: label)),
            Switch(
              key: Key('setting-${item.key}'),
              value: value,
              activeColor: AppTheme.primary,
              onChanged: (v) => setState(() => _edits[item.key] = v),
            ),
          ],
        );
      case 'select':
        final options = item.options ?? const <VeneraSettingOption>[];
        final current = '${_edits.containsKey(item.key) ? _edits[item.key] : item.value}';
        return Padding(
          padding: const EdgeInsets.only(top: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              label,
              DropdownButton<String>(
                key: Key('setting-${item.key}'),
                isExpanded: true,
                value: options.any((o) => o.value == current) ? current : null,
                items: [
                  for (final option in options)
                    DropdownMenuItem(
                      value: option.value,
                      child: Text(option.text, overflow: TextOverflow.ellipsis),
                    ),
                ],
                onChanged: (v) => setState(() => _edits[item.key] = v),
              ),
            ],
          ),
        );
    }
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Text('${item.title}：暂不支持「${item.type}」类型的设置项',
          key: Key('setting-unsupported-${item.key}'),
          style: const TextStyle(color: AppTheme.textTertiary, fontSize: 12)),
    );
  }

  Widget _buildLogin(VeneraSourceInfo info) {
    return Container(
      margin: const EdgeInsets.only(top: 12),
      padding: const EdgeInsets.all(16),
      decoration: panelDecoration(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('账号登录',
              style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 13)),
          const SizedBox(height: 4),
          const Text('口令仅加密保存在本机，不会写入日志或同步。',
              style: TextStyle(color: AppTheme.textTertiary, fontSize: 11)),
          if (info.canPasswordLogin && info.isLogged) ...[
            const SizedBox(height: 8),
            const Text('当前已登录', key: Key('login-state'), style: TextStyle(color: AppTheme.success)),
            OutlinedButton(
              key: const Key('login-logout'),
              onPressed: _working ? null : _logout,
              child: const Text('退出登录'),
            ),
          ] else if (info.canPasswordLogin) ...[
            TextField(
              key: const Key('login-account'),
              controller: _userController,
              style: const TextStyle(color: Colors.white, fontSize: 13),
              decoration: const InputDecoration(labelText: '账号'),
            ),
            TextField(
              key: const Key('login-password'),
              controller: _passwordController,
              obscureText: true,
              enableSuggestions: false,
              autocorrect: false,
              style: const TextStyle(color: Colors.white, fontSize: 13),
              decoration: const InputDecoration(labelText: '密码'),
            ),
            const SizedBox(height: 8),
            FilledButton(
              key: const Key('login-submit'),
              onPressed: _working ? null : _login,
              child: const Text('登录'),
            ),
          ],
          if (info.hasWebLogin || info.hasCookieLogin)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                info.canPasswordLogin
                    ? '网页登录、Cookie 登录与验证码验证暂不支持。'
                    : '此来源需要网页登录或 Cookie 登录（可能含验证码），手机端暂不支持。',
                key: const Key('login-unsupported'),
                style: const TextStyle(color: AppTheme.warning, fontSize: 12),
              ),
            ),
        ],
      ),
    );
  }
}
