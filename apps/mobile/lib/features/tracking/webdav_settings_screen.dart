import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/theme/app_theme.dart';
import 'webdav_provider.dart';

const double _maxContentWidth = 640;

String formatWebDavTime(DateTime time) {
  final local = time.toLocal();
  String two(int value) => value.toString().padLeft(2, '0');
  return '${local.year}-${two(local.month)}-${two(local.day)} '
      '${two(local.hour)}:${two(local.minute)}:${two(local.second)}';
}

class WebDavSettingsScreen extends ConsumerStatefulWidget {
  const WebDavSettingsScreen({super.key});

  @override
  ConsumerState<WebDavSettingsScreen> createState() => _WebDavSettingsScreenState();
}

class _WebDavSettingsScreenState extends ConsumerState<WebDavSettingsScreen> {
  final _urlController = TextEditingController();
  final _userController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _allowHttp = false;
  bool _obscurePassword = true;

  WebDavSettingsController get _controller => ref.read(webDavSettingsProvider.notifier);

  @override
  void initState() {
    super.initState();
    for (final controller in [_urlController, _userController, _passwordController]) {
      controller.addListener(_onFormChanged);
    }
    final current = ref.read(webDavSettingsProvider);
    if (current.loaded) {
      _fill(current.saved);
    }
    if (!current.isBusy) {
      Future.microtask(_load);
    }
  }

  @override
  void dispose() {
    _urlController.dispose();
    _userController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  void _onFormChanged() {
    if (mounted) setState(() {});
  }

  void _fill(WebDavSavedConfig? saved) {
    _urlController.text = saved?.url ?? '';
    _userController.text = saved?.username ?? '';
    _passwordController.clear();
    _allowHttp = saved?.allowInsecureHttp ?? false;
  }

  Future<void> _load() async {
    if (!mounted) return;
    await _controller.load();
  }

  void _onStateChanged(WebDavSettingsState? previous, WebDavSettingsState next) {
    if (previous?.loaded != true && next.loaded && mounted) {
      setState(() => _fill(next.saved));
    }
  }

  WebDavConfigInput _resolve(WebDavSavedConfig? saved) {
    return resolveWebDavForm(
      url: _urlController.text,
      username: _userController.text,
      password: _passwordController.text,
      allowInsecureHttp: _allowHttp,
      saved: saved,
    );
  }

  bool _isDirty(WebDavSavedConfig? saved) {
    if (saved == null) return true;
    return normalizeWebDavUrl(_urlController.text) != normalizeWebDavUrl(saved.url) ||
        _userController.text.trim() != saved.username ||
        _allowHttp != saved.allowInsecureHttp ||
        _passwordController.text.isNotEmpty;
  }

  Future<void> _save() async {
    FocusScope.of(context).unfocus();
    final ok = await _controller.save(_resolve);
    if (!mounted || !ok) return;
    setState(() => _fill(ref.read(webDavSettingsProvider).saved));
  }

  Future<void> _test() async {
    FocusScope.of(context).unfocus();
    await _controller.testConnection(_resolve);
  }

  Future<void> _sync() async {
    FocusScope.of(context).unfocus();
    await _controller.syncNow();
  }

  Future<void> _clear() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: AppTheme.surface,
        title: const Text('清除 WebDAV 配置？', style: TextStyle(color: AppTheme.textPrimary)),
        content: const Text(
          '只会清除本机保存的 WebDAV 地址、用户名和密码。本地收藏与进度保留，WebDAV 上的文件也不会被删除。',
          style: TextStyle(color: AppTheme.textSecondary, fontSize: 13),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('取消', style: TextStyle(color: AppTheme.textSecondary)),
          ),
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('清除', style: TextStyle(color: AppTheme.danger)),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    final ok = await _controller.clearConfig();
    if (!mounted || !ok) return;
    setState(() => _fill(null));
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(webDavSettingsProvider, _onStateChanged);
    final state = ref.watch(webDavSettingsProvider);
    final disabled = state.isBusy || !state.loaded;
    final dirty = _isDirty(state.saved);

    return Scaffold(
      backgroundColor: AppTheme.background,
      appBar: AppBar(
        title: const Text('WebDAV 同步', style: TextStyle(fontWeight: FontWeight.bold)),
        backgroundColor: Colors.transparent,
        elevation: 0,
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 32),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: _maxContentWidth),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _buildIntro(),
                  const SizedBox(height: 20),
                  ..._buildForm(state, disabled),
                  const SizedBox(height: 16),
                  _buildActions(state, disabled, dirty),
                  if (state.busy == WebDavBusy.loading) ...[
                    const SizedBox(height: 12),
                    const LinearProgressIndicator(color: AppTheme.primary),
                  ],
                  if (state.error != null)
                    _messageBox(state.error!, AppTheme.danger, const Key('webdav-error')),
                  if (state.notice != null)
                    _messageBox(state.notice!, AppTheme.success, const Key('webdav-notice')),
                  const SizedBox(height: 20),
                  _buildStatus(state),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildIntro() {
    const lines = [
      '手机直接连接你自己的 WebDAV 网盘，不依赖电脑或 Titanhub 服务器。',
      '电脑端与手机需填写同一个 WebDAV 地址（同一目录）和能访问它的账号，同步数据位于其中的 Titanhub/sync/v1。',
      '只同步收藏与观看/阅读进度；不会同步或安装来源，同步来的条目若本机没有对应来源需另行安装。',
      '密码只保存在本机安全存储，不会写入 WebDAV 或普通设置。',
    ];
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(AppTheme.radiusXL),
        border: Border.all(color: AppTheme.surfaceLight),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final line in lines)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: Text('· $line',
                  style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12, height: 1.4)),
            ),
        ],
      ),
    );
  }

  InputDecoration _decoration(String label, {String? hint, String? helper, Widget? suffix}) {
    return InputDecoration(
      labelText: label,
      hintText: hint,
      helperText: helper,
      helperMaxLines: 2,
      helperStyle: const TextStyle(color: AppTheme.textTertiary, fontSize: 11),
      labelStyle: const TextStyle(color: AppTheme.textSecondary),
      hintStyle: const TextStyle(color: AppTheme.textTertiary, fontSize: 12),
      enabledBorder: const UnderlineInputBorder(borderSide: BorderSide(color: AppTheme.surfaceElevated)),
      focusedBorder: const UnderlineInputBorder(borderSide: BorderSide(color: AppTheme.primary)),
      suffixIcon: suffix,
    );
  }

  List<Widget> _buildForm(WebDavSettingsState state, bool disabled) {
    final hasSavedPassword = state.saved?.hasPassword ?? false;
    return [
      TextField(
        key: const Key('webdav-url'),
        controller: _urlController,
        enabled: !disabled,
        keyboardType: TextInputType.url,
        autocorrect: false,
        enableSuggestions: false,
        textInputAction: TextInputAction.next,
        style: const TextStyle(color: AppTheme.textPrimary),
        decoration: _decoration('WebDAV 地址', hint: 'https://dav.example.com/dav'),
      ),
      const SizedBox(height: 8),
      TextField(
        key: const Key('webdav-username'),
        controller: _userController,
        enabled: !disabled,
        autocorrect: false,
        enableSuggestions: false,
        textInputAction: TextInputAction.next,
        style: const TextStyle(color: AppTheme.textPrimary),
        decoration: _decoration('用户名'),
      ),
      const SizedBox(height: 8),
      TextField(
        key: const Key('webdav-password'),
        controller: _passwordController,
        enabled: !disabled,
        obscureText: _obscurePassword,
        autocorrect: false,
        enableSuggestions: false,
        keyboardType: TextInputType.visiblePassword,
        textInputAction: TextInputAction.done,
        style: const TextStyle(color: AppTheme.textPrimary),
        decoration: _decoration(
          '密码',
          helper: hasSavedPassword ? '已保存（不回显）；地址和用户名不变时留空即保留原密码' : '必填',
          suffix: IconButton(
            tooltip: _obscurePassword ? '显示输入的密码' : '隐藏密码',
            icon: Icon(_obscurePassword ? Icons.visibility_off : Icons.visibility,
                color: AppTheme.textTertiary, size: 20),
            onPressed: () => setState(() => _obscurePassword = !_obscurePassword),
          ),
        ),
      ),
      const SizedBox(height: 8),
      SwitchListTile(
        key: const Key('webdav-allow-http'),
        contentPadding: EdgeInsets.zero,
        value: _allowHttp,
        activeColor: AppTheme.warning,
        title: const Text('允许不安全的 HTTP',
            style: TextStyle(color: AppTheme.textPrimary, fontSize: 14)),
        subtitle: const Text('默认只允许 HTTPS',
            style: TextStyle(color: AppTheme.textTertiary, fontSize: 11)),
        onChanged: disabled ? null : (value) => setState(() => _allowHttp = value),
      ),
      if (_allowHttp)
        _messageBox(
          'HTTP 会以明文传输用户名、密码和同步内容，同一网络中的他人可能截获。仅在可信的局域网内使用。',
          AppTheme.warning,
          const Key('webdav-http-warning'),
        ),
    ];
  }

  Widget _busyLabel(String label, bool active) {
    if (!active) return Text(label);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        const SizedBox(
          width: 14,
          height: 14,
          child: CircularProgressIndicator(strokeWidth: 2, color: AppTheme.textPrimary),
        ),
        const SizedBox(width: 8),
        Text(label),
      ],
    );
  }

  Widget _buildActions(WebDavSettingsState state, bool disabled, bool dirty) {
    final primaryStyle = ElevatedButton.styleFrom(
      backgroundColor: AppTheme.primary,
      foregroundColor: Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppTheme.radiusMD)),
    );
    final canSync = !disabled && state.saved != null && !dirty;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 12,
          runSpacing: 8,
          children: [
            ElevatedButton(
              key: const Key('webdav-save'),
              style: primaryStyle,
              onPressed: disabled ? null : _save,
              child: _busyLabel('保存', state.busy == WebDavBusy.saving),
            ),
            OutlinedButton(
              key: const Key('webdav-test'),
              onPressed: disabled ? null : _test,
              child: _busyLabel('测试连接', state.busy == WebDavBusy.testing),
            ),
            ElevatedButton(
              key: const Key('webdav-sync'),
              style: primaryStyle,
              onPressed: canSync ? _sync : null,
              child: _busyLabel('立即同步', state.busy == WebDavBusy.syncing),
            ),
            TextButton(
              key: const Key('webdav-clear'),
              onPressed: disabled || (state.saved == null && state.error == null) ? null : _clear,
              child: _busyLabel('清除配置', state.busy == WebDavBusy.clearing),
            ),
          ],
        ),
        if (state.saved != null && dirty && !state.isBusy)
          const Padding(
            padding: EdgeInsets.only(top: 6),
            child: Text('有未保存的修改，保存后才能立即同步。',
                style: TextStyle(color: AppTheme.textTertiary, fontSize: 11)),
          ),
      ],
    );
  }

  Widget _messageBox(String text, Color color, Key key) {
    return Container(
      key: key,
      margin: const EdgeInsets.only(top: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(AppTheme.radiusLG),
      ),
      child: Text(text, style: TextStyle(color: color, fontSize: 12, height: 1.4)),
    );
  }

  Widget _buildStatus(WebDavSettingsState state) {
    final status = state.status;
    final last = status.lastSuccessAt;
    final pending = status.pendingLocalChanges;
    return Container(
      key: const Key('webdav-status'),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(AppTheme.radiusXL),
        border: Border.all(color: AppTheme.surfaceLight),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('同步状态',
              style: TextStyle(color: AppTheme.textPrimary, fontSize: 15, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Text(
            last == null ? '最后成功同步：尚未成功同步' : '最后成功同步：${formatWebDavTime(last)}',
            style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12),
          ),
          const SizedBox(height: 4),
          Text(
            '未上传的本机变更：$pending',
            style: TextStyle(
              color: pending > 0 ? AppTheme.warning : AppTheme.textSecondary,
              fontSize: 12,
            ),
          ),
          for (final warning in status.warnings)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text('⚠ ${sanitizeWebDavError(warning)}',
                  style: const TextStyle(color: AppTheme.warning, fontSize: 12)),
            ),
        ],
      ),
    );
  }
}
