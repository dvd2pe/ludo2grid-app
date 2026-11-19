import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show SystemNavigator, rootBundle;
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

/// JiuTianJiuDi — app Flutter minimale: serve il gioco web (assets/www/ludo.html
/// + grid9.js: tavola a 9 quadranti con slot 3x3 numerati 1-9, vassoio con le
/// 9 pedine colorate, schermata iniziale PLAY/RESET, nessun riferimento ludo)
/// bundlato offline e lo mostra in un WebView.
///
/// Il gioco viene servito con un server HTTP locale (127.0.0.1) e non più
/// con loadFlutterAsset/file://: da una pagina file:// le XHR del bootstrap
/// di Cocos Creator verso file:// sono bloccate dal WebView (same-origin) e
/// il gioco resta in caricamento per sempre → schermo nero. Con
/// http://127.0.0.1 l'origine è regolare e tutte le richieste relative
/// funzionano, completamente offline. Richiede il permesso INTERNET (anche
/// solo per il loopback) e il cleartext consentito per 127.0.0.1 nel
/// network-security-config del manifest.
///
/// Nessuna UI nativa, nessun fallback: l'app È la versione web ludo-based.
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final baseUrl = await _startLocalServer();
  runApp(JiuTianJiuDiLudoApp(baseUrl: baseUrl));
}

/// Server HTTP di sola lettura sui file del gioco bundlati in FlutterAssets.
Future<String> _startLocalServer() async {
  final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
  server.listen((request) async {
    try {
      await _serveAsset(request);
    } catch (e) {
      try {
        request.response.statusCode = HttpStatus.internalServerError;
        await request.response.close();
      } catch (_) {}
    }
  });
  return 'http://127.0.0.1:${server.port}';
}

Future<void> _serveAsset(HttpRequest request) async {
  var path = Uri.decodeFull(request.uri.path);
  if (path == '/') path = '/ludo.html';
  // Solo asset del gioco, niente traversing: le chiavi di rootBundle sono
  // percorsi piatti, ma si estrae comunque 'assets/www/…' sanificato.
  if (!path.startsWith('/') || path.contains('..')) {
    request.response.statusCode = HttpStatus.notFound;
    await request.response.close();
    return;
  }
  final assetKey = 'assets/www$path';
  try {
    final data = await rootBundle.load(assetKey);
    final bytes = data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes);
    if (request.method != 'HEAD') {
      request.response.headers.contentType = _contentType(path);
      request.response.contentLength = bytes.length;
      request.response.add(bytes);
    }
    await request.response.close();
  } catch (_) {
    request.response.statusCode = HttpStatus.notFound;
    await request.response.close();
  }
}

ContentType _contentType(String path) {
  const types = <String, String>{
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.ttf': 'font/ttf',
    '.plist': 'application/xml',
  };
  final dot = path.lastIndexOf('.');
  final ext = dot < 0 ? '' : path.substring(dot).toLowerCase();
  return ContentType.parse(types[ext] ?? 'application/octet-stream');
}

class JiuTianJiuDiLudoApp extends StatelessWidget {
  const JiuTianJiuDiLudoApp({super.key, required this.baseUrl});

  final String baseUrl;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'JiuTianJiuDi',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(scaffoldBackgroundColor: const Color(0xFF171717)),
      home: LudoShellPage(baseUrl: baseUrl),
    );
  }
}

class LudoShellPage extends StatefulWidget {
  const LudoShellPage({super.key, required this.baseUrl});

  final String baseUrl;

  @override
  State<LudoShellPage> createState() => _LudoShellPageState();
}

class _LudoShellPageState extends State<LudoShellPage> {
  late final WebViewController _controller;

  @override
  void initState() {
    super.initState();
    _controller = WebViewController.fromPlatformCreationParams(
      AndroidWebViewControllerCreationParams(),
    )
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(const Color(0xFF171717))
      ..setOnConsoleMessage((message) {
        debugPrint('[Web ${message.level.name}] ${message.message}');
      })
      ..loadRequest(Uri.parse('${widget.baseUrl}/ludo.html'));

    // Audio di gioco: parte senza attendere un gesto dell'utente.
    (_controller.platform as AndroidWebViewController)
        .setMediaPlaybackRequiresUserGesture(false);
  }

  /// Tasto indietro Android: dalla tavola torna alla SCHERMATA INIZIALE del
  /// gioco (Grid9API.onBack gestisce l'overlay home in JS); se siamo già in
  /// home, o il gioco non è ancora pronto, l'app si chiude normalmente.
  Future<void> _onSystemBack() async {
    try {
      final r = await _controller.runJavaScriptReturningFuture(
          "window.Grid9API && Grid9API.onBack ? Grid9API.onBack() : 'exit'");
      if (r.toString() == 'exit') await SystemNavigator.pop();
    } catch (_) {
      await SystemNavigator.pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    // Hybrid composition: il canvas WebGL del gioco non regge il rendering
    // su SurfaceTexture della modalità default.
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (bool didPop, Object? result) {
        if (didPop) return;
        _onSystemBack();
      },
      child: Scaffold(
        backgroundColor: const Color(0xFF171717),
        body: WebViewWidget.fromPlatformCreationParams(
          params: AndroidWebViewWidgetCreationParams(
            controller: _controller.platform,
            displayWithHybridComposition: true,
          ),
        ),
      ),
    );
  }
}
