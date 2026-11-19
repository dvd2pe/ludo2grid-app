/*
 * JiuTianJiuDi — tavola a 9 quadranti (3x3) per il portale web
 * -------------------------------------------------------------
 * Grafica = ritagli reali dal tabellone Ludo (atlante A57), ripuliti:
 *   grid9/quad.png          = piastrella del quadrante (tintata a runtime, bordo rifilato)
 *   grid9/circle.png        = cerchio bianco trasparente -> slot grigio tintato a runtime
 *   grid9/circle3d_c0..8.png= pedine 3D lucide (una per colore), sfondo trasparente
 * Nessuna box bianca, nessuna texture con sfondo quadrato: i quadrati
 * attorno ai cerchetti segnalati dall'utente erano lo sfondo opaco di
 * circle3d_gray.png e la box bianca: entrambi rimossi.
 *
 * Cosa fa a runtime:
 *   1. dall' Lobby entra da sola nella GameScene esistente;
 *   2. nasconde TUTTI i riferimenti ludo: logo, HUD (monete/Classic/gemme/
 *      ingranaggi/back), profili, sprite del tabellone sotto la tavola;
 *   3. SCHERMATA INIZIALE (home): titolo + PLAY + RESET, mostrata all'avvio
 *      e richiamabile col tasto indietro di Android (Grid9API.onBack);
 *   4. tavola: 9 quadranti (3x3) × 9 slot NUMERATI 1-9 in griglia 3x3
 *      (ogni quadrante parte da 1) + vassoio in basso con 9 pedine (×9);
 *   5. DRAG AND DROP che SEGUE IL DITO: le coordinate touch vengono
 *      convertite con convertTouchToNodeSpace (prima si usava
 *      convertToNodeSpace(getLocation()) -> coordinate specchiate: il
 *      fantasma partiva da tutt'altra parte);
 *   6. LIBERTÀ DI SBAGLIARE: la pedina N si può posare su QUALSIASI slot
 *      libero di QUALSIASI quadrante (il gioco non blocca niente); il
 *      quadrante del colore giusto viene solo evidenziato come suggerimento.
 *      Quadrante pieno (9/9) -> toast + pulsazione; se inoltre tutte le
 *      pedine sono del colore giusto -> "Perfect!";
 *   7. una pedina piazzata si sposta su altri slot o si rimette nel vassoio;
 *   8. interfaccia in INGLESE; window.Grid9API per il layer realtime.
 */
(function () {
  "use strict";

  // ── Palette (9 quadranti) ──
  var QUAD_HEX = ["#C0392B", "#E07B28", "#3AA6A0", "#27AE60", "#8AB52A", "#7D9471", "#B64A8F", "#8B5E3C", "#E884A5"];
  var QUAD_NAMES = ["Red", "Orange", "Teal", "Green", "Lime", "Sage", "Magenta", "Brown", "Pink"];
  var CELLS = 81, QUAD_CELLS = 9;

  // geometria dentro GameBoard (626x626)
  var TILE = 200, TILE_STEP = 204, TILE_ORIGIN = -204; // 3 tile da 200 + 2 gap da 4 = 608
  var SLOT = 40, SLOT_STEP = 56;                        // slot 3x3: centri a -56/0/+56 su entrambi gli assi
  var TRAY_DISC = 46, TRAY_STEP = 52, TRAY_Y = -392;    // vassoio in basso al canvas

  // ── Stato ──
  var state = {
    slots: new Array(CELLS).fill(false),      // slot occupato?
    slotPawn: new Array(CELLS).fill(-1),      // tipo di pedina posata nello slot (-1 = vuoto)
    quadFilled: new Array(9).fill(0),
    quadsDone: new Array(9).fill(false),
    quadsPerfect: new Array(9).fill(false),
    placed: 0,
    paused: false
  };
  var sprites = { quad: null, box: null, circle: null, c3d: [null, null, null, null, null, null, null, null, null] };
  var assetsReady = false;
  var boardParent = null, tileNodes = null, slotNodes = null, discNodes = null,
      progressLabel = null, trayNodes = null, trayCountLabels = null,
      slotWorld = null, trayWorld = null;
  var drag = null; // { fromTray: bool, num: tipo pedina, fromSlot: idx|null, ghost: node }
  var entered = false, entering = false, homeActive = false, welcomed = false;

  function hexToCc(hex) {
    var n = parseInt(hex.slice(1), 16);
    return cc.color((n >> 16) & 255, (n >> 8) & 255, n & 255);
  }

  function makeSprite(frame, w, h, x, y, z) {
    var node = new cc.Node("g9");
    var sp = node.addComponent(cc.Sprite);
    sp.spriteFrame = frame;
    sp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
    node.setContentSize(w, h);
    node.setPosition(x, y);
    if (z !== undefined) node.zIndex = z;
    return node;
  }

  function makeNumberLabel(parent, str, size, rgb) {
    var n = new cc.Node("num");
    var l = n.addComponent(cc.Label);
    l.string = str;
    l.fontSize = size;
    l.lineHeight = size + 2;
    l.horizontalAlign = cc.Label.HorizontalAlign.CENTER;
    l.verticalAlign = cc.Label.VerticalAlign.CENTER;
    try {
      l.enableOutline = true;
      l.outlineColor = cc.color(40, 30, 20);
      l.outlineWidth = 2;
    } catch (e) { /* outline non disponibile */ }
    n.color = rgb ? cc.color(rgb[0], rgb[1], rgb[2]) : cc.color(255, 255, 255);
    n.zIndex = 2;
    n.parent = parent;
    return n;
  }

  // texture 3D della pedina per il tipo t (fallback: cerchio bianco tintato)
  function discFrame(t) {
    return sprites.c3d[t] || sprites.circle;
  }

  // SpriteFrame monocromatico generato a runtime (cc.DrawNode NON esiste in
  // questo build del runtime): canvas 8x8 -> cc.Texture2D.
  function solidFrame(rgb) {
    try {
      var c = document.createElement('canvas');
      c.width = 8;
      c.height = 8;
      var g = c.getContext('2d');
      g.fillStyle = 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
      g.fillRect(0, 0, 8, 8);
      var tex = new cc.Texture2D();
      tex.initWithElement(c);
      tex.handleLoadedTexture();
      return new cc.SpriteFrame(tex);
    } catch (e) {
      return null;
    }
  }

  // nodo di sfondo pieno che copre tutto il canvas (blu notte)
  function makeSolidBg(parent, name, z) {
    var navy = [24, 42, 84];
    var f = solidFrame(navy);
    var node;
    if (f) {
      node = makeSprite(f, 1800, 1200, 0, 0, 0);
    } else if (sprites.box) {
      node = makeSprite(sprites.box, 1800, 1200, 0, 0, 0);
      node.color = cc.color(navy[0], navy[1], navy[2]);
    } else {
      return null;
    }
    node.name = name;
    node.zIndex = z;
    node.parent = parent;
    return node;
  }

  // Conversioni touch VERIFICATE a runtime con probe su coordinate note:
  // - t.getLocation() -> coordinate MONDO corrette (slot a wy=694 -> schermo y=199);
  //   (l'uso di convertToNodeSpace(ev.getLocation()) coi vecchi valori era il
  //   bug che metteva il fantasma "da tutt'altra parte")
  // - i figli DIRETTI di Canvas (fantasma, vassoio) hanno origine nell'ANCHOR
  //   point del Canvas (creator, ignoreAnchor=false): serve convertToNodeSpaceAR;
  // - i nodi annidati (Cells) si convertono da mondo con convertToNodeSpace.
  function touchOf(ev) {
    return (ev && ev.getTouch) ? ev.getTouch() : ((ev && ev.touch) ? ev.touch : ev);
  }
  function touchWorld(ev) {
    var t = touchOf(ev);
    try { return t.getLocation(); } catch (e) { return null; }
  }
  function touchToCanvas(ev, canvas) { // coordinate figlio-di-Canvas
    var w = touchWorld(ev);
    if (w) {
      try { return canvas.convertToNodeSpaceAR(w); } catch (e) {}
    }
    try { return canvas.convertTouchToNodeSpaceAR(touchOf(ev)); } catch (e) { return cc.v2(0, 0); }
  }
  function worldToLocal(w, node) { // coordinate locali di nodi annidati
    try { return node.convertToNodeSpace(w); } catch (e) { return cc.v2(0, 0); }
  }

  // ── Caricamento dei ritagli ──
  function loadAssets(done) {
    if (assetsReady) { done(); return; }
    var list = ["grid9/quad.png", "grid9/box.png", "grid9/circle.png",
                "grid9/circle3d_c0.png", "grid9/circle3d_c1.png", "grid9/circle3d_c2.png",
                "grid9/circle3d_c3.png", "grid9/circle3d_c4.png", "grid9/circle3d_c5.png",
                "grid9/circle3d_c6.png", "grid9/circle3d_c7.png", "grid9/circle3d_c8.png"];
    var left = list.length;
    list.forEach(function (url) {
      cc.loader.load(url, function (err, tex) {
        if (!err && tex) {
          var sf = new cc.SpriteFrame(tex);
          if (url.indexOf("circle3d_c") > -1) {
            var q = parseInt(url.slice(-5, -4), 10);
            if (!isNaN(q)) sprites.c3d[q] = sf;
          }
          else if (url.indexOf("quad") > -1) sprites.quad = sf;
          else if (url.indexOf("box") > -1) sprites.box = sf;
          else sprites.circle = sf;
        } else {
          console.warn("[Grid9] asset non caricato:", url);
        }
        if (--left === 0) {
          assetsReady = !!(sprites.quad && sprites.circle);
          done();
        }
      });
    });
  }

  // posizione dello slot n (0..8) del quadrante q in coordinate boardParent.
  // Griglia 3x3, numeri 1-9 in lettura (1-3 riga alta, 4-6 centro, 7-9 bassa):
  // OGNI quadrante parte da 1.
  function slotPos(q, n) {
    var qRow = Math.floor(q / 3), qCol = q % 3;
    var tx = TILE_ORIGIN + qCol * TILE_STEP;
    var ty = TILE_ORIGIN + (2 - qRow) * TILE_STEP;
    var row = Math.floor(n / 3), col = n % 3;
    return {
      x: tx + (col - 1) * SLOT_STEP,
      y: ty + (1 - row) * SLOT_STEP
    };
  }

  // ── Costruzione della tavola: 9 quadranti × 9 slot (3x3, numeri 1-9) ──
  function buildGrid9() {
    boardParent = cc.find("Canvas/Content/BoardContent/GameBoard/Cells");
    if (!boardParent) { console.error("[Grid9] Cells non trovato"); return false; }

    boardParent.removeAllChildren();
    tileNodes = []; slotNodes = []; discNodes = []; slotWorld = [];

    for (var q = 0; q < 9; q++) {
      var qRow = Math.floor(q / 3), qCol = q % 3;
      var tx = TILE_ORIGIN + qCol * TILE_STEP;
      var ty = TILE_ORIGIN + (2 - qRow) * TILE_STEP;

      // piastrella del quadrante, tintata
      var tile = makeSprite(sprites.quad, TILE, TILE, tx, ty, -3);
      tile.color = hexToCc(QUAD_HEX[q]);
      tile.name = "quad_" + q;
      tile.parent = boardParent;
      tileNodes.push(tile);

      // 9 slot liberi NUMERATI 1..9 in griglia 3x3 (nessuna box bianca:
      // i slot stanno direttamente sulla piastrella colorata)
      for (var n = 0; n < QUAD_CELLS; n++) {
        var i = q * QUAD_CELLS + n;
        var p = slotPos(q, n);

        var snode = makeSprite(sprites.circle, SLOT, SLOT, p.x, p.y, -1);
        snode.color = cc.color(188, 193, 199); // grigio chiaro: slot vuoto
        snode.name = "slot_" + i;
        makeNumberLabel(snode, String(n + 1), 16, [55, 60, 66]);
        snode.parent = boardParent;
        slotNodes.push(snode);
        // posizione WORLD dello slot (le conversioni per-nodo del gioco hanno
        // anchor offset incoerenti: confrontiamo tutto in coordinate mondo)
        slotWorld.push(snode.convertToWorldSpaceAR(cc.v2(0, 0)));

        // nodo pedina (nascosto finché non si posa): prende il NUMERO e il
        // COLORE della pedina trascinata, qualsiasi quadrante (errori ammessi)
        var dnode = makeSprite(discFrame(q), SLOT, SLOT, p.x, p.y, 6);
        dnode.active = false;
        dnode.name = "disc_" + i;
        makeNumberLabel(dnode, String(n + 1), 17);
        (function (idx) {
          dnode.on(cc.Node.EventType.TOUCH_START, function (ev) { startDrag(false, idx, ev); }, dnode);
          dnode.on(cc.Node.EventType.TOUCH_MOVE, function (ev) { moveDrag(ev); }, dnode);
          dnode.on(cc.Node.EventType.TOUCH_END, function (ev) { endDrag(ev); }, dnode);
          dnode.on(cc.Node.EventType.TOUCH_CANCEL, function (ev) { cancelDrag(ev); }, dnode);
        })(i);
        dnode.parent = boardParent;
        discNodes.push(dnode);
      }
    }

    // progresso sopra la tavola
    progressLabel = new cc.Node("g9_progress");
    var pl = progressLabel.addComponent(cc.Label);
    pl.string = "";
    pl.fontSize = 20;
    pl.lineHeight = 24;
    progressLabel.color = cc.color(255, 255, 255);
    progressLabel.setPosition(0, TILE_ORIGIN + (2 * TILE_STEP) + TILE / 2 + 22);
    progressLabel.zIndex = 50;
    progressLabel.parent = boardParent;

    buildTray();
    return true;
  }

  // ── Vassoio con le 9 pedine numerate 1-9 (×9 ciascuna) ──
  function buildTray() {
    var canvas = cc.find("Canvas");
    if (!canvas) return;
    var old = canvas.getChildByName("g9_tray");
    if (old) old.destroy();

    var tray = new cc.Node("g9_tray");
    tray.zIndex = 900;
    tray.parent = canvas;
    trayNodes = []; trayCountLabels = []; trayWorld = [];

    for (var t = 0; t < 9; t++) {
      var x = -TRAY_STEP * 4 + t * TRAY_STEP;
      var node = makeSprite(discFrame(t), TRAY_DISC, TRAY_DISC, x, TRAY_Y, 0);
      node.name = "tray_" + t;
      makeNumberLabel(node, String(t + 1), 24);
      var cnt = new cc.Node("cnt");
      var cl = cnt.addComponent(cc.Label);
      cl.string = "×9";
      cl.fontSize = 14;
      cl.lineHeight = 16;
      cnt.color = cc.color(255, 255, 255);
      cnt.setPosition(0, -TRAY_DISC / 2 - 10);
      cnt.parent = node;
      trayCountLabels.push(cl);

      (function (num) {
        node.on(cc.Node.EventType.TOUCH_START, function (ev) { startDrag(true, num, ev); }, node);
        node.on(cc.Node.EventType.TOUCH_MOVE, function (ev) { moveDrag(ev); }, node);
        node.on(cc.Node.EventType.TOUCH_END, function (ev) { endDrag(ev); }, node);
        node.on(cc.Node.EventType.TOUCH_CANCEL, function (ev) { cancelDrag(ev); }, node);
      })(t);

      node.parent = tray;
      trayNodes.push(node);
      trayWorld.push(node.convertToWorldSpaceAR(cc.v2(0, 0)));
    }
  }

  // quante pedine di tipo t sono ancora nel vassoio
  function pawnUsed(t) {
    var c = 0;
    for (var i = 0; i < CELLS; i++) if (state.slots[i] && state.slotPawn[i] === t) c++;
    return c;
  }
  function pawnRemaining(t) { return QUAD_CELLS - pawnUsed(t); }

  // ── Drag and drop: il fantasma SEGUE il dito ──
  function startDrag(fromTray, num, ev) {
    (window.__G9_TOUCH_LOG = window.__G9_TOUCH_LOG || []).push("start n=" + num + " tray=" + fromTray);
    if (state.paused || !boardParent) return;
    var fromSlot = null;
    if (!fromTray) {
      // pedina già posata: l'evento porta l'INDICE dello slot
      fromSlot = num;
      num = state.slotPawn[fromSlot];
      if (num < 0) return;
      // solleva la pedina: lo slot si libera fin da subito
      liftDisc(fromSlot);
      discNodes[fromSlot].active = false;
    } else if (pawnRemaining(num) <= 0) {
      toast("The " + QUAD_NAMES[num] + " pawns are finished!");
      return;
    }

    var canvas = cc.find("Canvas");
    var ghost = makeSprite(discFrame(num), SLOT, SLOT, 0, 0, 1000);
    makeNumberLabel(ghost, String(num + 1), 17);
    ghost.setScale(1.25);
    var p = touchToCanvas(ev, canvas);
    ghost.setPosition(p);
    ghost.parent = canvas;
    if (fromTray) trayNodes[num].opacity = 120;
    highlight(num, true);
    drag = { fromTray: fromTray, num: num, fromSlot: fromSlot, ghost: ghost, lastWorld: touchWorld(ev) };
  }

  function moveDrag(ev) {
    (window.__G9_TOUCH_LOG = window.__G9_TOUCH_LOG || []).push("move");
    if (!drag) return;
    var canvas = cc.find("Canvas");
    drag.ghost.setPosition(touchToCanvas(ev, canvas));
    drag.lastWorld = touchWorld(ev);
  }

  function endDrag(ev) {
    (window.__G9_TOUCH_LOG = window.__G9_TOUCH_LOG || []).push("end");
    finishDrag(ev);
  }

  function finishDrag(ev) {
    if (!drag) return;
    var canvas = cc.find("Canvas");
    var num = drag.num, fromTray = drag.fromTray, fromSlot = drag.fromSlot;
    // il mouse-up/touch-end in alcuni ambienti arriva come TOUCH_CANCEL con
    // posizione vuota: usa l'ultima posizione nota della doccia
    var w = touchWorld(ev);
    if (!w || (w.x === 0 && w.y === 0)) w = drag.lastWorld;
    drag.ghost.destroy();
    drag = null;
    highlight(num, false);
    if (fromTray) trayNodes[num].opacity = pawnRemaining(num) > 0 ? 255 : 130;
    if (!w) { refresh(); return; }

    var canvasP = canvas.convertToNodeSpaceAR(w);

    // riconsegna nel vassoio = rimozione della pedina (confronto in mondo)
    var trayW = trayWorld[num] || cc.v2(0, TRAY_Y);
    if (!fromTray && w.y < trayW.y + TRAY_DISC / 2 + 8) {
      // già sollevata al startDrag: resta rimossa
      refresh();
      return;
    }

    // cerca lo slot libero PIÙ VICINO in QUALSIASI quadrante (raggio 30):
    // si può sbagliare quadrante — il gioco non blocca niente
    var best = -1, bestD = 30 * 30;
    for (var i = 0; i < CELLS; i++) {
      if (state.slots[i]) continue;
      var sw = slotWorld[i];
      var dx = sw.x - w.x, dy = sw.y - w.y;
      var d2 = dx * dx + dy * dy;
      if (d2 < bestD) { bestD = d2; best = i; }
    }
    if (best >= 0) {
      placeDisc(best, num);
    } else if (fromSlot !== null) {
      placeDisc(fromSlot, num); // nessuno slot vicino: torna al suo posto
    } else {
      toast("Drop the pawn on any free circle — " + QUAD_NAMES[num] + " is its home!");
    }
    refresh();
  }

  function cancelDrag(ev) {
    (window.__G9_TOUCH_LOG = window.__G9_TOUCH_LOG || []).push("cancel");
    // in alcuni ambienti il mouseup arriva come TOUCH_CANCEL:
    // il drop viene comunque completato con l'ultimo punto toccato
    finishDrag(ev);
  }

  function placeDisc(i, pawn) {
    if (state.slots[i]) return;
    state.slots[i] = true;
    state.slotPawn[i] = pawn;
    var q = Math.floor(i / QUAD_CELLS);
    state.quadFilled[q]++;
    state.placed++;

    // visual della pedina: numero e colore della pedina trascinata
    var dnode = discNodes[i];
    var sp = dnode.getComponent(cc.Sprite);
    if (sp) sp.spriteFrame = discFrame(pawn);
    var lbl = dnode.getChildByName("num");
    if (lbl && lbl.getComponent(cc.Label)) lbl.getComponent(cc.Label).string = String(pawn + 1);
    dnode.active = true;
    snapBack(i);

    if (state.quadFilled[q] === QUAD_CELLS && !state.quadsDone[q]) {
      state.quadsDone[q] = true;
      var perfect = quadAllCorrect(q);
      state.quadsPerfect[q] = perfect;
      if (perfect) {
        toast("Perfect! " + QUAD_NAMES[q] + " has all its pawns! (" + doneQuads() + "/9)");
      } else {
        toast("Quadrant " + QUAD_NAMES[q] + " filled! (" + doneQuads() + "/9)");
      }
      var tile = tileNodes[q];
      if (tile) {
        tile.stopAllActions();
        tile.runAction(cc.sequence(
          cc.scaleTo(0.12, 1.05),
          cc.scaleTo(0.12, 1.0),
          cc.scaleTo(0.12, 1.03),
          cc.scaleTo(0.12, 1.0)
        ));
      }
    }
  }

  // tutte le pedine nel quadrante q sono del colore giusto?
  function quadAllCorrect(q) {
    for (var n = 0; n < QUAD_CELLS; n++) {
      if (state.slotPawn[q * QUAD_CELLS + n] !== q) return false;
    }
    return true;
  }

  // toglie la pedina dallo stato (senza visual): usata quando la si solleva
  function liftDisc(i) {
    if (!state.slots[i]) return;
    state.slots[i] = false;
    var q = Math.floor(i / QUAD_CELLS);
    state.quadFilled[q]--;
    state.placed--;
    state.slotPawn[i] = -1;
    if (state.quadsDone[q] && state.quadFilled[q] < QUAD_CELLS) state.quadsDone[q] = false;
    if (state.quadsPerfect[q]) state.quadsPerfect[q] = false;
  }

  function removeDisc(i) {
    liftDisc(i);
    snapBack(i);
  }

  function snapBack(i) {
    var node = discNodes[i];
    if (!node) return;
    var q = Math.floor(i / QUAD_CELLS);
    var p = slotPos(q, i % QUAD_CELLS);
    node.setPosition(p.x, p.y);
    node.setScale(1);
  }

  function doneQuads() {
    var c = 0;
    for (var q = 0; q < 9; q++) if (state.quadsDone[q]) c++;
    return c;
  }

  function highlight(q, on) {
    for (var n = 0; n < QUAD_CELLS; n++) {
      var i = q * QUAD_CELLS + n;
      var node = slotNodes[i];
      if (!node) continue;
      if (on && !state.slots[i]) {
        node.setScale(1.25);          // lo slot libero del quadrante giusto si ingrandisce
      } else {
        node.setScale(1);
      }
    }
  }

  // ── Render ──
  function refresh() {
    if (!discNodes) return;
    for (var i = 0; i < CELLS; i++) {
      discNodes[i].active = state.slots[i];
    }
    for (var t = 0; t < 9; t++) {
      var rem = pawnRemaining(t);
      if (trayCountLabels && trayCountLabels[t]) trayCountLabels[t].string = "×" + rem;
      if (trayNodes && trayNodes[t]) trayNodes[t].opacity = rem > 0 ? 255 : 130;
    }
    if (progressLabel) {
      progressLabel.getComponent(cc.Label).string =
        "Quadrants " + doneQuads() + "/9   ·   Pawns " + state.placed + "/81";
    }
  }

  // ── Toast su canvas ──
  function toast(msg) {
    var canvas = cc.find("Canvas");
    if (!canvas) return;
    var n = new cc.Node("g9_toast");
    var l = n.addComponent(cc.Label);
    l.string = msg;
    l.fontSize = 22;
    l.lineHeight = 26;
    n.color = cc.color(255, 255, 255);
    try { l.enableOutline = true; l.outlineColor = cc.color(40, 30, 20); l.outlineWidth = 2; } catch (e) {}
    n.setPosition(0, 385);
    n.zIndex = 999;
    n.parent = canvas;
    n.runAction(cc.sequence(cc.delayTime(1.4), cc.fadeOut(0.8), cc.removeSelf()));
  }

  // ── SCHERMATA INIZIALE (home): titolo + PLAY + RESET ──
  function buildHome() {
    var canvas = cc.find("Canvas");
    if (!canvas) return null;
    var home = new cc.Node("g9_home");
    home.zIndex = 3000;

    // sfondo pieno (blu notte, nessun riferimento al gioco originale)
    makeSolidBg(home, "g9_home_bg", 0);

    var title = new cc.Node("g9_title");
    var tl = title.addComponent(cc.Label);
    tl.string = "JiuTianJiuDi";
    tl.fontSize = 60;
    tl.lineHeight = 66;
    title.color = cc.color(255, 255, 255);
    try { tl.enableOutline = true; tl.outlineColor = cc.color(10, 20, 44); tl.outlineWidth = 3; } catch (e) {}
    title.setPosition(0, 150);
    home.addChild(title);

    var sub = new cc.Node("g9_sub");
    var sl = sub.addComponent(cc.Label);
    sl.string = "9 quadrants · 3x3 slots · numbers 1-9";
    sl.fontSize = 20;
    sl.lineHeight = 24;
    sub.color = cc.color(178, 198, 232);
    sub.setPosition(0, 105);
    home.addChild(sub);

    // PLAY
    var play = makeSprite(sprites.box, 260, 80, 0, -20, 1);
    play.color = cc.color(39, 174, 96);
    play.name = "g9_play";
    makeNumberLabel(play, "PLAY", 34);
    play.on(cc.Node.EventType.TOUCH_END, function () { hideHome(); }, play);
    home.addChild(play);

    // RESET (visibile solo se c'è progresso)
    var reset = makeSprite(sprites.box, 180, 56, 0, -110, 1);
    reset.color = cc.color(110, 118, 130);
    reset.name = "g9_reset";
    makeNumberLabel(reset, "RESET", 24);
    reset.on(cc.Node.EventType.TOUCH_END, function () {
      Grid9API_reset();
      toast("Board cleared!");
    }, reset);
    home.addChild(reset);
    home.__g9_reset = reset;

    home.parent = canvas;
    return home;
  }

  function Grid9API_reset() {
    state.slots.fill(false);
    state.slotPawn.fill(-1);
    state.quadFilled.fill(0);
    state.quadsDone.fill(false);
    state.quadsPerfect.fill(false);
    state.placed = 0;
    refresh();
  }

  function showHome() {
    var canvas = cc.find("Canvas");
    if (!canvas) return;
    var home = canvas.getChildByName("g9_home") || buildHome();
    if (!home) return;
    if (home.__g9_reset) home.__g9_reset.active = state.placed > 0;
    home.active = true;
    homeActive = true;
    state.paused = true;
  }

  function hideHome() {
    var canvas = cc.find("Canvas");
    var home = canvas && canvas.getChildByName("g9_home");
    if (home) home.active = false;
    homeActive = false;
    state.paused = false;
    refresh();
    if (!welcomed) {
      welcomed = true;
      toast("Drag the pawns onto the circles — each color has its home quadrant!");
    }
  }

  // ── Nodi del gioco originale da tenere fuori ──
  // Nessun riferimento a ludo resta visibile: anche lo sfondo a frecce
  // (RushModeBackground), l'HUD e i profili vengono nascosti; al loro posto
  // enterGrid9 mette un blu pieno (g9_bg). Il tasto indietro è quello di
  // Android -> schermata iniziale.
  var JUNK = ["RushGameBoard", "WaitingPanel", "FftueNode", "AnimNodes",
              "DebugLayer", "powerupNodeV2", "SafeLocations", "TileHighlightLocation", "timer",
              "PawnContainer", "MyPlayerNode", "TopGamehud", "ProfileContainer",
              "RushModeBackground",
              "SwordAnimPlaceholder", "SwordAnimationMetaNode", "PowerupPlayerNode", "Popups",
              "loadingBg", "ConfettiSpine1", "ConfettiSpine2", "ConfettiSpine3", "ConfettiSpine4",
              "winPopups", "chatprefab", "chatprefab2", "chatprefab3", "chatprefab4",
              "clickPanel", "toolTipNode", "New Label"];

  function hideJunk() {
    var bb = cc.find("Canvas/Content/BoardContent");
    if (!bb) return;
    JUNK.forEach(function (name) {
      var n = bb.getChildByName(name) || cc.find("Canvas/Content/" + name) || cc.find("Canvas/" + name);
      if (n) {
        n.active = false;
        // se la logica di gioco li riattiva, restano fuori dallo schermo
        n.setPosition(-3000, -3000);
      }
    });
    var touchCatcher = cc.find("Canvas/touchNode");
    if (touchCatcher && touchCatcher.active) touchCatcher.active = false;

    // lo sprite del tabellone ludo ON GameBoard: disattivato (sotto la tavola
    // restava visibile il board originale)
    var gameBoard = cc.find("Canvas/Content/BoardContent/GameBoard");
    if (gameBoard) {
      try {
        var gsp = gameBoard.getComponent(cc.Sprite);
        if (gsp) gsp.enabled = false;
      } catch (e) {}
      // qualunque altro figlio del GameBoard che non sia la nostra Cells va spento
      var ch = gameBoard.children || [];
      for (var i = 0; i < ch.length; i++) {
        if (ch[i].name !== "Cells" && ch[i].active) {
          ch[i].active = false;
          ch[i].setPosition(-3000, -3000);
        }
      }
    }
    // idem su Cells (il nostro contenitore): niente sprite proprio
    var cells = cc.find("Canvas/Content/BoardContent/GameBoard/Cells");
    if (cells) {
      try {
        var csp = cells.getComponent(cc.Sprite);
        if (csp) csp.enabled = false;
      } catch (e) {}
    }
  }

  // ── Branding: niente logo Ludo durante il loading / lobby ──
  function normName(s) {
    return (s || "").toLowerCase().replace(/[\s_\-]/g, "");
  }
  var BRAND_NODES = ["ludologo", "fontlabel", "loadingtext"];
  function hideBranding() {
    var scene = cc.director.getScene();
    if (!scene) return;
    var sn = scene.name || "";
    if (sn !== "LoadingScene" && sn !== "Lobby") return;
    var stack = [scene];
    var seen = 0;
    while (stack.length && seen < 600) {
      var n = stack.pop();
      if (!n || n.__g9_brand_hidden) continue;
      seen++;
      var nn = normName(n.name);
      if (BRAND_NODES.indexOf(nn) > -1) {
        n.active = false;
        n.__g9_brand_hidden = true;
        continue;
      }
      var comps = n.components || [];
      for (var i = 0; i < comps.length; i++) {
        var sp = comps[i];
        if (sp && sp.spriteFrame) {
          var nm = "";
          try { nm = sp.spriteFrame.getName ? sp.spriteFrame.getName() : (sp.spriteFrame._name || ""); } catch (e) { nm = ""; }
          if (normName(nm).indexOf("ludologo") > -1) {
            n.active = false;
            n.__g9_brand_hidden = true;
          }
        }
      }
      var ch = n.children || [];
      for (var c = 0; c < ch.length; c++) stack.push(ch[c]);
    }
  }

  // ── Entrata nella modalità tavola dentro la GameScene esistente ──
  function enterGrid9() {
    if (entered) return;
    var bb = cc.find("Canvas/Content/BoardContent");
    if (!bb) return;
    hideJunk();
    var gameBoard = cc.find("Canvas/Content/BoardContent/GameBoard");
    if (!gameBoard) return;
    if (!buildGrid9()) return;

    // sfondo pieno (blu notte) al posto dello sfondo a frecce del gioco
    var canvas = cc.find("Canvas");
    if (canvas && !canvas.getChildByName("g9_bg")) {
      makeSolidBg(canvas, "g9_bg", -500);
    }

    entered = true;
    window.__G9_READY__ = true;
    refresh();
    showHome(); // schermata iniziale: titolo + PLAY
  }

  // ── Lobby: ingresso diretto nella tavola ──
  function hookLobby() {
    if (entering) return true;
    entering = true;
    setTimeout(function () {
      try {
        if (!entered) {
          cc.director.loadScene("GameScene");
        }
      } catch (e) {
        console.error("[Grid9]", e);
        entering = false;
      }
    }, 1200);
    return true;
  }

  // ── Punti di aggancio ──
  setInterval(function () {
    try { if (cc.director && cc.director.getScene()) hideBranding(); } catch (e) {}
  }, 150);

  setInterval(function () {
    try {
      if (!cc.director) return;
      var s = cc.director.getScene();
      if (!s) return;
      if (s.name === "Lobby") hookLobby();
      if (s.name === "GameScene") {
        hideJunk();
        // rimuovi nodi spawnati dal gioco originale dentro Cells (cell_*, rowNode, ...)
        if (entered && boardParent) {
          var chB = boardParent.children;
          for (var ib = chB.length - 1; ib >= 0; ib--) {
            var nm = chB[ib].name || "";
            if (!/^quad_/.test(nm) && !/^slot_/.test(nm) &&
                !/^disc_/.test(nm) && nm !== "g9_progress") chB[ib].destroy();
          }
        }
        if (!assetsReady) { loadAssets(function () {}); return; }
        if (!discNodes) { loadAssets(enterGrid9); return; }
        if (!entered) loadAssets(enterGrid9);
      }
    } catch (e) {
      console.error("[Grid9]", e);
    }
  }, 400);

  // API pubblica: qui si aggancia il layer realtime reale
  window.Grid9API = {
    state: state,
    enterMode: enterGrid9,
    setPaused: function (v) { state.paused = v; },
    // posa programmatica di una pedina (slot 0..80, tipo pedina 0..8): usata
    // dal layer realtime e dai test
    place: function (slot, pawn) {
      if (!entered || slot < 0 || slot >= CELLS || pawn < 0 || pawn > 8) return false;
      if (state.slots[slot]) return false;
      placeDisc(slot, pawn);
      refresh();
      return true;
    },
    isHome: function () { return homeActive; },
    // parte dal gioco dalla schermata iniziale (equivalente a premere PLAY)
    startGame: function () { if (entered) hideHome(); },
    onBack: function () {
      // tasto indietro Android: dalla tavola -> schermata iniziale;
      // dalla schermata iniziale -> l'app si chiude
      if (!entered || homeActive) return "exit";
      showHome();
      return "handled";
    },
    reset: function () { Grid9API_reset(); }
  };
})();
