import 'dart:async';

import 'package:flutter_inappwebview_platform_interface/flutter_inappwebview_platform_interface.dart';

import 'video_resolver.dart';

const _bridgeHandler = 'TitanhubMedia';
const _startupTimeout = Duration(seconds: 10);

const _probeScript = r'''
(function () {
  if (window.__titanhubProbe) return;
  window.__titanhubProbe = true;
  function report(kind, url) {
    try {
      if (!url || String(url).indexOf('blob:') === 0) return;
      var abs = new URL(url, location.href).href;
      window.flutter_inappwebview.callHandler('TitanhubMedia', {
        kind: kind, url: abs, frame: location.href, ua: navigator.userAgent
      });
    } catch (e) {}
  }
  function isPlaylist(text) {
    return typeof text === 'string' && text.trim().indexOf('#EXTM3U') === 0;
  }
  var xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    var xhr = this;
    xhr.addEventListener('load', function () {
      try {
        if (isPlaylist(xhr.responseText)) report('hls', xhr.responseURL || url);
      } catch (e) {}
    });
    return xhrOpen.apply(this, arguments);
  };
  var responseText = Response.prototype.text;
  Response.prototype.text = function () {
    var response = this;
    return responseText.call(this).then(function (text) {
      if (isPlaylist(text)) report('hls', response.url);
      return text;
    });
  };
  function inspect(el) {
    var name = el.nodeName;
    var src = el.getAttribute('src') || (name === 'VIDEO' ? el.currentSrc : '');
    if (src) report(name === 'IFRAME' ? 'iframe' : 'video', src);
  }
  function scan(root) {
    if (root.querySelectorAll) root.querySelectorAll('video,source,iframe').forEach(inspect);
  }
  new MutationObserver(function (mutations) {
    mutations.forEach(function (m) {
      if (m.type === 'attributes') { inspect(m.target); return; }
      m.addedNodes.forEach(function (node) {
        if (node.nodeType !== 1) return;
        if (/^(VIDEO|SOURCE|IFRAME)$/.test(node.nodeName)) inspect(node);
        scan(node);
      });
    });
  }).observe(document.documentElement || document, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['src']
  });
  document.addEventListener('DOMContentLoaded', function () { scan(document); });
})();
''';

InAppWebViewSettings buildProbeSettings(PageProbeRequest request) {
  return InAppWebViewSettings(
    javaScriptEnabled: true,
    userAgent: request.userAgent ?? '',
    useShouldOverrideUrlLoading: true,
    useShouldInterceptRequest: true,
    mediaPlaybackRequiresUserGesture: true,
    mixedContentMode: MixedContentMode.MIXED_CONTENT_ALWAYS_ALLOW,
    cacheEnabled: false,
    blockNetworkImage: true,
    allowFileAccess: false,
    allowContentAccess: false,
    allowFileAccessFromFileURLs: false,
    allowUniversalAccessFromFileURLs: false,
    geolocationEnabled: false,
    supportMultipleWindows: false,
    javaScriptCanOpenWindowsAutomatically: false,
  );
}

Future<PageProbe> createWebViewPageProbe(
  PageProbeRequest request,
  void Function(MediaCandidate candidate) onCandidate,
) async {
  final probe = _WebViewPageProbe(request, onCandidate);
  try {
    await probe._start();
  } catch (_) {
    await probe.dispose();
    rethrow;
  }
  return probe;
}

class _WebViewPageProbe implements PageProbe {
  _WebViewPageProbe(this._request, this._onCandidate);

  final PageProbeRequest _request;
  final void Function(MediaCandidate candidate) _onCandidate;
  PlatformHeadlessInAppWebView? _webView;
  bool _disposed = false;

  void _emit(MediaCandidate? candidate) {
    if (!_disposed && candidate != null) _onCandidate(candidate);
  }

  Future<void> _start() async {
    final created = Completer<PlatformInAppWebViewController>();
    _webView = PlatformHeadlessInAppWebView(
      PlatformHeadlessInAppWebViewCreationParams(
        initialSettings: buildProbeSettings(_request),
        onWebViewCreated: (controller) {
          if (!created.isCompleted) created.complete(controller);
        },
        shouldOverrideUrlLoading: (controller, action) async {
          return isAllowedNavigation(action.request.url?.toString())
              ? NavigationActionPolicy.ALLOW
              : NavigationActionPolicy.CANCEL;
        },
        shouldInterceptRequest: (controller, request) async {
          _emit(networkCandidate(request.url.toString(), request.headers));
          return null;
        },
        onPermissionRequest: (controller, request) async {
          return PermissionResponse(
            resources: request.resources,
            action: PermissionResponseAction.DENY,
          );
        },
        onGeolocationPermissionsShowPrompt: (controller, origin) async {
          return GeolocationPermissionShowPromptResponse(
            origin: origin,
            allow: false,
            retain: false,
          );
        },
        onCreateWindow: (controller, action) async => false,
      ),
    );
    await _webView!.run().timeout(_startupTimeout);
    final controller = await created.future.timeout(_startupTimeout);
    if (_disposed) return;
    controller.addJavaScriptHandler(
      handlerName: _bridgeHandler,
      callback: (args) {
        if (args.isNotEmpty) _emit(candidateFromBridgeMessage(args.first));
        return null;
      },
    );
    await controller.addUserScript(
      userScript: UserScript(
        source: _probeScript,
        injectionTime: UserScriptInjectionTime.AT_DOCUMENT_START,
        forMainFrameOnly: false,
      ),
    );
    if (_disposed) return;
    await controller.loadUrl(
      urlRequest: URLRequest(url: WebUri(_request.pageUrl), headers: _request.requestHeaders),
    );
  }

  @override
  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    final webView = _webView;
    _webView = null;
    await webView?.dispose();
  }
}
