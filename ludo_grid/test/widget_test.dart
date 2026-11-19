import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// Custodisce la consegna: il bundle web caricato dall'app DEVE essere la
/// versione ludo-based (grid9 ten-frame 1-10, sfondo blu, HUD ludo), come
/// nelle immagini di riferimento (tavola_vuota, quadrante_completo,
/// loading_senza_ludo).
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('l app carica ludo.html con grid9 (ludo-based), non jiugong', () async {
    final html = await rootBundle.loadString('assets/www/ludo.html');
    expect(html, contains('grid9.js'));
    expect(html, isNot(contains('jiugong')));
  });

  test('grid9.js è il riferimento ludo-based (HUD: monete/Classic/gemme/ingranaggi)', () async {
    final js = await rootBundle.loadString('assets/www/grid9.js');
    expect(js, contains('Classic'));
    expect(js, contains('gemme'));
    expect(js, contains('ingranaggi'));
  });

  test('nessuna traccia della versione marrone (MVP eliminato)', () async {
    final js = await rootBundle.loadString('assets/www/grid9.js');
    expect(js, isNot(contains('Bruno')));
    expect(js, isNot(contains('Ayla')));
    expect(js, isNot(contains('Chen')));
    expect(js, isNot(contains('tocca un cerchio')));
  });
}
