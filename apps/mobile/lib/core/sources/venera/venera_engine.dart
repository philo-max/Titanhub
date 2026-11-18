import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_js/flutter_js.dart';

import 'venera_catalog.dart';
import 'venera_cookies.dart';
import 'venera_host.dart';
import 'venera_models.dart';
import 'venera_shim_bridge.dart';
import 'venera_shim_core.dart';
import 'venera_shim_source.dart';

const Set<String> veneraBridgeMethods = {
  'describe',
  'searchPage',
  'explore',
  'detail',
  'info',
  'chapters',
  'images',
  'login',
  'logout',
  'init',
};

class VeneraSourceException extends VeneraException {
  const VeneraSourceException(
    super.message, {
    this.httpStatus,
    this.loginSignal = false,
    this.businessSignal = false,
  });

  final int? httpStatus;
  final bool loginSignal;
  final bool businessSignal;
}

final RegExp _loginSignalPattern = RegExp(
  r'login required|please log ?in|sign in required|unauthori[sz]ed|not logged|未登录|请先登录|请登录|需要登录|登录已过期|登录失效|token\s*(?:expired|invalid)',
  caseSensitive: false,
);

final RegExp _businessSignalPattern = RegExp(
  r'不存在|已被删除|已删除|已下架|does not exist|no such (?:comic|manga|book)',
  caseSensitive: false,
);

final RegExp _statusMentionPattern = RegExp(r'status|状态码|http', caseSensitive: false);

typedef VeneraRuntimeFactory = JavascriptRuntime Function();

JavascriptRuntime createVeneraRuntime() => getJavascriptRuntime(xhr: false);

class VeneraEngine {
  VeneraEngine._(this._runtime, this.host, this.limits);

  static Future<VeneraEngine> create({
    required String code,
    required VeneraPersist persist,
    Map<String, dynamic>? data,
    VeneraCookieJar? cookies,
    VeneraLimits limits = const VeneraLimits(),
    VeneraRuntimeFactory runtimeFactory = createVeneraRuntime,
    Dio? dio,
  }) async {
    final match = veneraClassPattern.firstMatch(code);
    if (match == null) throw const VeneraException('不是有效的 Venera 来源：缺少 class … extends ComicSource');
    final runtime = runtimeFactory();
    late final VeneraEngine engine;
    final host = VeneraHost(
          settle: (id, json) => engine._evaluateQuietly('__veneraSettle(${jsonEncode(id)}, ${jsonEncode(json)})'),
          persist: persist,
          data: data,
          cookies: cookies,
          limits: limits,
          dio: dio,
    );
    engine = VeneraEngine._(runtime, host, limits);
    try {
      runtime.onMessage('host', (dynamic args) => host.handle(args is String ? args : jsonEncode(args)));
      runtime.onMessage('veneraDone', engine._onDone);
      engine._evalOrThrow(veneraShimCore, '宿主环境');
      engine._evalOrThrow(veneraShimSource, '宿主环境');
      engine._evalOrThrow(veneraShimBridge, '宿主环境');
      engine._evalOrThrow(
        '(function(){\n$code\n;globalThis.__veneraInstance = new ${match.group(1)}();globalThis.__veneraSnapshotSettings(globalThis.__veneraInstance);\n}).call(globalThis);',
        '来源脚本',
      );
    } catch (_) {
      engine.dispose();
      rethrow;
    }
    return engine;
  }

  final JavascriptRuntime _runtime;
  final VeneraHost host;
  final VeneraLimits limits;
  final Completer<void> _cancelled = Completer<void>();
  Future<void> _queue = Future.value();
  bool _disposed = false;
  bool _initialized = false;
  bool _broken = false;
  int _callSeq = 0;
  final Map<int, Completer<String>> _pendingCalls = {};

  bool get isUsable => !_disposed && !_broken;

  void _evaluateQuietly(String script) {
    if (_disposed) return;
    try {
      _runtime.evaluate(script);
    } catch (_) {}
  }

  void _evalOrThrow(String script, String what) {
    final result = _runtime.evaluate(script);
    if (result.isError) {
      throw VeneraException('$what 加载失败：${_shorten(result.stringResult)}');
    }
  }

  static String _shorten(String text) {
    final trimmed = text.trim();
    return trimmed.length > 300 ? '${trimmed.substring(0, 300)}…' : trimmed;
  }

  void cancel() {
    if (!_cancelled.isCompleted) _cancelled.complete();
    _broken = true;
    host.cancelPending();
  }

  void dispose() {
    if (_disposed) return;
    _disposed = true;
    if (!_cancelled.isCompleted) _cancelled.complete();
    host.close();
    Timer(const Duration(milliseconds: 250), () {
      try {
        _runtime.dispose();
      } catch (_) {}
    });
  }

  Future<Object?> call(String method, [List<Object?> args = const []]) {
    if (!veneraBridgeMethods.contains(method)) {
      return Future.error(VeneraException('非法来源方法：$method'));
    }
    final completer = Completer<Object?>();
    _queue = _queue.catchError((_) {}).then((_) async {
      try {
        completer.complete(await _run(method, args));
      } catch (error) {
        completer.completeError(error);
      }
    });
    return completer.future;
  }

  Future<Object?> _run(String method, List<Object?> args) async {
    if (!isUsable) throw const VeneraException('来源运行时已终止，请重试');
    if (!_initialized && method != 'init') {
      await _invoke('init', const []);
      _initialized = true;
    }
    return _invoke(method, args);
  }

  Future<Object?> _invoke(String method, List<Object?> args) async {
    host.resetBudget();
    final callId = ++_callSeq;
    final done = Completer<String>();
    _pendingCalls[callId] = done;
    final argsJson = args.map(jsonEncode).join(',').replaceAll(' ', r' ').replaceAll(' ', r' ');
    final script = '(async function(){var out;try{const v=await globalThis.__titan.$method($argsJson);'
        'out=JSON.stringify({ok:true,v:v===undefined?null:v});}catch(e){'
        'out=JSON.stringify({ok:false,e:String(e&&e.message?e.message:e)});}'
        'sendMessage("veneraDone",JSON.stringify({id:$callId,r:out}));})()';
    final started = _runtime.evaluate(script);
    if (started.isError) {
      _pendingCalls.remove(callId);
      throw VeneraException(_shorten(started.stringResult));
    }
    final pump = Timer.periodic(const Duration(milliseconds: 4), (_) {
      if (_disposed) return;
      try {
        _runtime.executePendingJob();
      } catch (_) {}
    });
    final String raw;
    try {
      raw = await Future.any([
        done.future,
        _cancelled.future.then((_) => throw const VeneraException('已取消')),
      ]).timeout(limits.callTimeout);
    } on TimeoutException {
      _broken = true;
      host.cancelPending();
      throw VeneraException('来源执行超时（${limits.callTimeout.inSeconds} 秒），已终止');
    } finally {
      pump.cancel();
      _pendingCalls.remove(callId);
    }
    final decoded = jsonDecode(raw);
    if (decoded is! Map) throw const VeneraException('来源返回了无法解析的结果');
    if (decoded['ok'] != true) throw _sourceFailure(_shorten('${decoded['e']}'));
    if (method == 'init') _initialized = true;
    return decoded['v'];
  }

  VeneraSourceException _sourceFailure(String core) {
    final failure = host.lastFailure;
    final related = failure != null && (core.contains('${failure.status}') || _statusMentionPattern.hasMatch(core));
    final status = related ? failure.status : null;
    final serverText = '$core ${related ? failure.serverMessage ?? '' : ''}';
    final bodySignal = host.lastResponse != null && _loginSignalPattern.hasMatch(host.lastResponse!.body);
    return VeneraSourceException(
      related ? '$core（${failure.format()}）' : core,
      httpStatus: status,
      loginSignal: _loginSignalPattern.hasMatch(serverText) || bodySignal,
      businessSignal: _businessSignalPattern.hasMatch(serverText),
    );
  }

  void _onDone(dynamic args) {
    final message = args is String ? jsonDecode(args) : args;
    if (message is! Map) return;
    final completer = _pendingCalls[(message['id'] as num).toInt()];
    if (completer != null && !completer.isCompleted) completer.complete('${message['r']}');
  }
}
