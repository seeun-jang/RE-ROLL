// 원본 assets/sprites.json 을 그대로 옮긴 것 (브라우저가 별도 요청 없이 바로 쓰도록 JS 모듈로 둔다)
export default {
 "_comment": "픽셀 아트 스프라이트. 각 프레임은 문자열 행 배열, 문자는 assets/palette.json의 key로 팔레트 인덱스에 대응. '.'은 투명. tools/export_sprites.py로 PNG로 내보낼 수 있다.",
 "player": {
  "w": 16,
  "h": 24,
  "frames": [
   [
    "......oooo......",
    ".....oyyyyo.....",
    ".....oyyyyo.....",
    "...ooOOOOOOoo...",
    "...OOOOOOOOOO...",
    ".....tttttt.....",
    ".....tttKtt.....",
    ".....tttttt.....",
    "......tttt......",
    ".....bbbbbb.....",
    "....bbbbbbbbb...",
    "....bbbbbbbKKKKK",
    "....bbbbbbbbK...",
    ".....bbbbbb.....",
    ".....bbbbbb.....",
    ".....BBBBBB.....",
    ".....BBBBBB.....",
    ".....BB..BB.....",
    ".....BB..BB.....",
    ".....BB..BB.....",
    ".....BB..BB.....",
    ".....mm..mm.....",
    "....mmm..mmm....",
    "....MMM..MMM...."
   ],
   [
    "......oooo......",
    ".....oyyyyo.....",
    ".....oyyyyo.....",
    "...ooOOOOOOoo...",
    "...OOOOOOOOOO...",
    ".....tttttt.....",
    ".....tttKtt.....",
    ".....tttttt.....",
    "......tttt......",
    ".....bbbbbb.....",
    "....bbbbbbbKKKKK",
    "....bbbbbbbbK...",
    "....bbbbbbbbb...",
    ".....bbbbbb.....",
    ".....bbbbbb.....",
    ".....BBBBBB.....",
    ".....BBBBBB.....",
    ".....BB..BB.....",
    ".....BB..BB.....",
    ".....BB..BB.....",
    ".....BB..BB.....",
    ".....mm..mm.....",
    "....mmm..mmm....",
    "....MMM..MMM...."
   ],
   [
    "......oooo......",
    ".....oyyyyo.....",
    ".....oyyyyo.....",
    "...ooOOOOOOoo...",
    "...OOOOOOOOOO...",
    ".....tttttt.....",
    ".....ttttKt.....",
    ".....tttttt.....",
    "......tttt......",
    ".....bbbbbb.....",
    "....bbbbbbbb....",
    "....bbbbbbKKKK..",
    "....bbbbbbbK....",
    ".....bbbbbb.....",
    ".....bbbbbb.....",
    ".....BBBBBB.....",
    ".....BBBBBB.....",
    ".....BB..BB.....",
    ".....BB..BB.....",
    ".....BB..BB.....",
    ".....BB..BB.....",
    ".....mm..mm.....",
    "....mmm..mmm....",
    "....MMM..MMM...."
   ]
  ]
 },
 "muzzle": {
  "w": 6,
  "h": 5,
  "frames": [
   [
    "..yy..",
    ".yooy.",
    "yoWWoy",
    ".yooy.",
    "..yy.."
   ],
   [
    "......",
    "..oy..",
    ".yWWy.",
    "..yo..",
    "......"
   ]
  ]
 },
 "zombie": {
  "w": 16,
  "h": 24,
  "frames": [
   [
    "......KKKKK.....",
    ".....KgggggK....",
    "....KgggggggK...",
    "....KWKggggK....",
    "....KgggggggK...",
    ".....KgggggK....",
    "......KKgKK.....",
    ".......KgK......",
    "......PPPPPPP...",
    ".gggggPPPPPPP...",
    ".gggggPPPPPPP...",
    "......PPPpPPP...",
    "......PPPPPPP...",
    "......PpPPPPP...",
    "......PPPPPPP...",
    "......NNNNNNN...",
    "......NNN.NNN...",
    "......NNN.NNN...",
    "......NNN.NNN...",
    "......NNN.NNN...",
    "......NNN.NNN...",
    "......NNN.NNN...",
    "......KKK.KKK...",
    ".....KKKK.KKKK.."
   ],
   [
    "......KKKKK.....",
    ".....KgggggK....",
    "....KgggggggK...",
    "....KWKggggK....",
    "....KgggggggK...",
    ".....KgggggK....",
    "......KKgKK.....",
    ".......KgK......",
    ".gggggPPPPPPP...",
    ".gggggPPPPPPP...",
    "......PPPPPPP...",
    "......PPPpPPP...",
    "......PPPPPPP...",
    "......PpPPPPP...",
    "......PPPPPPP...",
    "......NNNNNNN...",
    ".....NNNN.kkk...",
    ".....NNN..kkkk..",
    "....NNN....kkk..",
    "....NNN....kkk..",
    "....NNN....kkk..",
    "....NNN....kkk..",
    "....KKK....KKK..",
    "...KKKK....KKKK."
   ],
   [
    "................",
    "......KKKKK.....",
    ".....KgggggK....",
    "....KgggggggK...",
    "....KWKggggK....",
    "....KgggggggK...",
    ".....KgggggK....",
    "......KKgKK.....",
    "......PPPPPPP...",
    "......PPPPPPP...",
    ".gggggPPPpPPP...",
    ".gggggPPPPPPP...",
    "......PPPPPPP...",
    "......PpPPPPP...",
    "......PPPPPPP...",
    "......NNNNNNN...",
    "......NNN.NNN...",
    "......NNN.NNN...",
    "......NNN.NNN...",
    "......NNN.NNN...",
    "......NNN.NNN...",
    "......NNN.NNN...",
    "......KKK.KKK...",
    ".....KKKK.KKKK.."
   ],
   [
    "......KKKKK.....",
    ".....KgggggK....",
    "....KgggggggK...",
    "....KWKggggK....",
    "....KgggggggK...",
    ".....KgggggK....",
    "......KKgKK.....",
    ".......KgK......",
    ".gggggPPPPPPP...",
    ".gggggPPPPPPP...",
    "......PPPPPPP...",
    "......PPPpPPP...",
    "......PPPPPPP...",
    "......PpPPPPP...",
    "......PPPPPPP...",
    "......NNNNNNN...",
    ".....kkkk.NNN...",
    ".....kkk..NNNN..",
    "....kkk....NNN..",
    "....kkk....NNN..",
    "....kkk....NNN..",
    "....kkk....NNN..",
    "....KKK....KKK..",
    "...KKKK....KKKK."
   ]
  ]
 },
 "zombie_jump": {
  "w": 16,
  "h": 24,
  "frames": [
   [
    "......KKKKK.....",
    ".....KgggggK....",
    "....KgggggggK...",
    "....KWKggggK....",
    "....KgggggggK...",
    ".....KgggggK....",
    "......KKgKK.....",
    ".gg....KgK......",
    "..ggg.PPPPPPP...",
    "...gggPPPPPPP...",
    "......PPPPPPP...",
    "......PPPpPPP...",
    "......PPPPPPP...",
    "......PpPPPPP...",
    "......PPPPPPP...",
    "......NNNNNNN...",
    "....NNNNNNNNN...",
    "...NNNNNN.NNN...",
    "...KKK.NNNNNN...",
    "..KKKK..KKKK....",
    "................",
    "................",
    "................",
    "................"
   ]
  ]
 },
 "runner": {
  "w": 16,
  "h": 24,
  "frames": [
   [
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "...KKKKK........",
    "..KgggggK.......",
    ".KgggggggK......",
    ".KWKggggK.......",
    ".KgggggggK......",
    "..KgggggKrrr....",
    "...KKgKKrrrrr...",
    "gggg.KrrrrrRrr..",
    "gggg.rrrrrrrrr..",
    ".....rrrRrrrrr..",
    "......rrrrrrr...",
    "......NNNNNNN...",
    ".....NNNN.NNNN..",
    "....NNN....NNNN.",
    "...NNN......NNN.",
    "..NNN.......NNN.",
    ".KKK........KKK.",
    "KKKK........KKKK"
   ],
   [
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "...KKKKK........",
    "..KgggggK.......",
    ".KgggggggK......",
    ".KWKggggK.......",
    ".KgggggggK......",
    "..KgggggKrrr....",
    "...KKgKKrrrrr...",
    ".ggggKrrrrrRrr..",
    ".gggg.rrrrrrrr..",
    ".....rrrRrrrrr..",
    "......rrrrrrr...",
    "......NNNNNNN...",
    "......NNNNNNN...",
    ".....NNNN.NNN...",
    ".....NNN..NNN...",
    "....NNN...NNN...",
    "....KKK...KKK...",
    "...KKKK...KKKK.."
   ]
  ]
 },
 "helmet": {
  "w": 10,
  "h": 5,
  "frames": [
   [
    "..KSSSSK..",
    ".KSSSSSSK.",
    "KSsssssssK",
    "KssssssssK",
    "KKKKKKKKKK"
   ],
   [
    "..KSSSSK..",
    ".KSSKSSSK.",
    "KSssKssssK",
    "KsssKKsssK",
    "KKKKKKKKKK"
   ]
  ]
 },
 "boss": {
  "w": 32,
  "h": 40,
  "frames": [
   [
    "..........KKKKKKKKKK............",
    "........KKgggggggggKK...........",
    ".......KgggggggggggggK..........",
    "......KgggggggggggggggK.........",
    "......KgggggggggggggggK.........",
    ".....KgggWWKgggggggggggK........",
    ".....KggWWWKgggggKKggggK........",
    ".....KgggWWKgggggKKggggK........",
    ".....KgggggggggggggggggK........",
    ".....KggggggggggggggggK.........",
    "......KKKKKKKKKKKKKKKK..........",
    "......KWKWKWKWKWKWKWKK..........",
    ".......KKKKKKKKKKKKKK...........",
    "..........KgggggK...............",
    "........PPPPPPPPPPPPPP..........",
    "......PPPPPPPPPPPPPPPPPP........",
    "ggggg.PPPPPPPPPPPPPPPPPPP.......",
    "gggggggPPPPPPPpPPPPPPPPPP.......",
    "gggggggPPPPPPPpPPPPPPPPPP.......",
    "ggggg.PPPPPPPPPPPPPPPPPPP.......",
    "......PPPPPPPPPPPPPPPPPPP.......",
    "......PPPPPPPPPPPPPPPPPPP.......",
    "......PPPpPPPPPPPPPPpPPPP.......",
    "......PPPPPPPPPPPPPPPPPPP.......",
    "......PPPPPPPPPPPPPPPPPPP.......",
    "......PPPPPPPPPPPPPPPPPP........",
    ".......PPPPPPPPPPPPPPPP.........",
    ".......NNNNNNNNNNNNNNNN.........",
    ".......NNNNNNNNNNNNNNNN.........",
    ".......NNNNNNNNNNNNNNNN.........",
    ".......NNNNNNN..NNNNNNN.........",
    ".......NNNNNNN..NNNNNNN.........",
    ".......NNNNNNN..NNNNNNN.........",
    ".......NNNNNNN..NNNNNNN.........",
    ".......NNNNNNN..NNNNNNN.........",
    ".......NNNNNNN..NNNNNNN.........",
    ".......NNNNNNN..NNNNNNN.........",
    ".......KKKKKKK..KKKKKKK.........",
    "......KKKKKKKK..KKKKKKKK........",
    "......KKKKKKKK..KKKKKKKK........"
   ],
   [
    "..........KKKKKKKKKK............",
    "........KKgggggggggKK...........",
    ".......KgggggggggggggK..........",
    "......KgggggggggggggggK.........",
    "......KgggggggggggggggK.........",
    ".....KgggWWKgggggggggggK........",
    ".....KggWWWKgggggKKggggK........",
    ".....KgggWWKgggggKKggggK........",
    ".....KgggggggggggggggggK........",
    ".....KggggggggggggggggK.........",
    "......KKKKKKKKKKKKKKKK..........",
    "......KWKWKWKWKWKWKWKK..........",
    ".......KKKKKKKKKKKKKK...........",
    "..........KgggggK...............",
    "........PPPPPPPPPPPPPP..........",
    "......PPPPPPPPPPPPPPPPPP........",
    "......PPPPPPPPPPPPPPPPPPP.......",
    "......PPPPPPPPPPPPPPPPPPP.......",
    "ggggg.PPPPPPPPPPPPPPPPPPP.......",
    "gggggggPPPPPPPpPPPPPPPPPP.......",
    "gggggggPPPPPPPpPPPPPPPPPP.......",
    "ggggg.PPPPPPPPPPPPPPPPPPP.......",
    "......PPPpPPPPPPPPPPpPPPP.......",
    "......PPPPPPPPPPPPPPPPPPP.......",
    "......PPPPPPPPPPPPPPPPPPP.......",
    "......PPPPPPPPPPPPPPPPPP........",
    ".......PPPPPPPPPPPPPPPP.........",
    ".......NNNNNNNNNNNNNNNN.........",
    ".......NNNNNNNNNNNNNNNN.........",
    ".......NNNNNNNNNNNNNNNN.........",
    ".......NNNNNNN..NNNNNNN.........",
    ".......NNNNNNN..NNNNNNN.........",
    ".....NNNNNNN....NNNNNNN.........",
    ".....NNNNNNN....NNNNNNN.........",
    ".....NNNNNNN....NNNNNNN.........",
    ".....NNNNNNN....NNNNNNN.........",
    ".....NNNNNNN....NNNNNNN.........",
    ".....KKKKKKK....KKKKKKK.........",
    "....KKKKKKKK....KKKKKKKK........",
    "....KKKKKKKK....KKKKKKKK........"
   ]
  ]
 },
 "turret_basic": {
  "w": 16,
  "h": 16,
  "frames": [
   [
    "................",
    "........KK......",
    ".......KggK.....",
    "......KgGGgKKKKK",
    "......KgGGgKssss",
    ".......KggKKKKK.",
    "....g...KK......",
    ".....g..GG......",
    "......gGG.......",
    "....EEEEEEEEE...",
    "....EhhhhhhhE...",
    ".....EhhhhhE....",
    ".....EhhhhhE....",
    ".....EmmmmmE....",
    "......EEEEE.....",
    "................"
   ],
   [
    "................",
    "........KK......",
    ".......KggK.....",
    "......KgGGgKKKK.",
    "......KgGGgKsss.",
    ".......KggKKKK..",
    "....g...KK......",
    ".....g..GG......",
    "......gGG.......",
    "....EEEEEEEEE...",
    "....EhhhhhhhE...",
    ".....EhhhhhE....",
    ".....EhhhhhE....",
    ".....EmmmmmE....",
    "......EEEEE.....",
    "................"
   ]
  ]
 },
 "turret_slow": {
  "w": 16,
  "h": 16,
  "frames": [
   [
    "................",
    ".......cc.......",
    "......cWWc......",
    ".....cWbbWc.....",
    ".....cWbbWc.....",
    "......cWWc......",
    ".......cc.......",
    "......gGG.......",
    ".....g.GG.......",
    "....BBBBBBBBB...",
    "....BbbbbbbbB...",
    ".....BbbbbbB....",
    ".....BbbbbbB....",
    ".....BBBBBBB....",
    "......BBBBB.....",
    "................"
   ],
   [
    "................",
    ".......WW.......",
    "......WccW......",
    ".....WcbbcW.....",
    ".....WcbbcW.....",
    "......WccW......",
    ".......WW.......",
    "......gGG.......",
    ".....g.GG.......",
    "....BBBBBBBBB...",
    "....BbbbbbbbB...",
    ".....BbbbbbB....",
    ".....BbbbbbB....",
    ".....BBBBBBB....",
    "......BBBBB.....",
    "................"
   ]
  ]
 },
 "barricade": {
  "w": 16,
  "h": 16,
  "frames": [
   [
    "................",
    "................",
    "...K........K...",
    "..KEK......KEK..",
    "..KEKEEEEEEKEK..",
    "..KEEhhhhhhEEK..",
    "..KEKhhhhhhKEK..",
    "..KEK......KEK..",
    "..KEKEEEEEEKEK..",
    "..KEEhhhhhhEEK..",
    "..KEKhhhhhhKEK..",
    "..KEK......KEK..",
    "..KEKEEEEEEKEK..",
    "..KEEhhhhhhEEK..",
    "..KEKKKKKKKKEK..",
    "..KKK......KKK.."
   ],
   [
    "................",
    "................",
    "...K........K...",
    "..KEK......KEK..",
    "..KEKEEE.EEKEK..",
    "..KEEhh.hh.EEK..",
    "..KEKhhhhhhKEK..",
    "..KEK......KEK..",
    "..KEK.EEEEEKEK..",
    "..KEEh.hhhhEEK..",
    "..KEKhh.h.hKEK..",
    "..KEK......KEK..",
    "..KEKEEEEEEKEK..",
    "..KEEhhhhhhEEK..",
    "..KEKKKKKKKKEK..",
    "..KKK......KKK.."
   ],
   [
    "................",
    "................",
    "...K............",
    "..KEK...........",
    "..KEKEE......K..",
    "..KEEh.......EK.",
    "..KEK......KEK..",
    "..KEK......KEK..",
    "..KEK.E.E..KEK..",
    "..KEE......EEK..",
    "..KEK..h...KEK..",
    "..KEK......KEK..",
    "..KEKEE..EEKEK..",
    "..KEEhh...hEEK..",
    "..KEKKKK.KKKEK..",
    "..KKK......KKK.."
   ]
  ]
 },
 "coin": {
  "w": 6,
  "h": 6,
  "frames": [
   [
    ".yyyy.",
    "yyoyyy",
    "yoyyyy",
    "yoyyyy",
    "yyoyyy",
    ".yyyy."
   ],
   [
    "..yy..",
    ".yoyy.",
    ".yoyy.",
    ".yoyy.",
    ".yoyy.",
    "..yy.."
   ],
   [
    "..oo..",
    "..oo..",
    "..oo..",
    "..oo..",
    "..oo..",
    "..oo.."
   ],
   [
    "..yy..",
    ".yyoy.",
    ".yyoy.",
    ".yyoy.",
    ".yyoy.",
    "..yy.."
   ]
  ]
 },
 "ammo": {
  "w": 8,
  "h": 7,
  "frames": [
   [
    "KKKKKKKK",
    "KGGGGGGK",
    "KGyyyyGK",
    "KGyoyoGK",
    "KGGGGGGK",
    "KGGGGGGK",
    "KKKKKKKK"
   ]
  ]
 },
 "heart": {
  "w": 7,
  "h": 6,
  "frames": [
   [
    ".rr.rr.",
    "rfrrrrr",
    "rrrrrrr",
    ".rrrrr.",
    "..rrr..",
    "...r..."
   ]
  ]
 },
 "bomb": {
  "w": 8,
  "h": 8,
  "frames": [
   [
    "....Ko..",
    "...Ky...",
    "..KKKK..",
    ".KNNNNK.",
    "KNNSNNNK",
    "KNNNNNNK",
    ".KNNNNK.",
    "..KKKK.."
   ],
   [
    "....Ky..",
    "...Ko...",
    "..KKKK..",
    ".KNNNNK.",
    "KNNSNNNK",
    "KNNNNNNK",
    ".KNNNNK.",
    "..KKKK.."
   ]
  ]
 },
 "icon_pistol": {
  "w": 12,
  "h": 7,
  "frames": [
   [
    "............",
    "KKKKKKKKK...",
    "KssssssssK..",
    "KKKKKssKKK..",
    "...KssK.....",
    "...KssK.....",
    "...KKKK....."
   ]
  ]
 },
 "icon_shotgun": {
  "w": 12,
  "h": 7,
  "frames": [
   [
    "............",
    "....KKKKKKKK",
    "KKKKKsssssss",
    "KEEEKKKKKKKK",
    "KEEEKKK.....",
    ".KEKKK......",
    "..KK........"
   ]
  ]
 },
 "icon_mg": {
  "w": 12,
  "h": 7,
  "frames": [
   [
    "..K.........",
    "KKKKKKKKKKKK",
    "KssssssssssK",
    "KKKKsKKKKKKK",
    "..KssK.KK...",
    "..KssK......",
    "..KKKK......"
   ]
  ]
 },
 "icon_sniper": {
  "w": 12,
  "h": 7,
  "frames": [
   [
    "....KKK.....",
    "KKKKKKKKKKKK",
    "KsssssssssKK",
    "KEEKKKKKK...",
    "KEEK.KK.....",
    ".KK..KK.....",
    "............"
   ]
  ]
 },
 "icon_tb": {
  "w": 8,
  "h": 8,
  "frames": [
   [
    "...KK...",
    "..KgKKKK",
    "..KgKsss",
    "...KK...",
    "..EEEE..",
    "..EhhE..",
    "...EE...",
    "........"
   ]
  ]
 },
 "icon_ts": {
  "w": 8,
  "h": 8,
  "frames": [
   [
    "...cc...",
    "..cWWc..",
    "..cWWc..",
    "...cc...",
    "..BBBB..",
    "..BbbB..",
    "...BB...",
    "........"
   ]
  ]
 },
 "icon_tw": {
  "w": 8,
  "h": 8,
  "frames": [
   [
    ".K....K.",
    ".KEEEEK.",
    ".KEhhEK.",
    ".K....K.",
    ".KEEEEK.",
    ".KEhhEK.",
    ".K....K.",
    "........"
   ]
  ]
 },
 "speaker": {
  "w": 7,
  "h": 7,
  "frames": [
   [
    "...S..S",
    "..SS.S.",
    "SSSS.S.",
    "SSSS.S.",
    "SSSS.S.",
    "..SS.S.",
    "...S..S"
   ],
   [
    "...S...",
    "..SS...",
    "SSSSr.r",
    "SSSS.r.",
    "SSSSr.r",
    "..SS...",
    "...S..."
   ]
  ]
 },
 "cursor": {
  "w": 7,
  "h": 7,
  "frames": [
   [
    "...W...",
    "...W...",
    "...K...",
    "WWK.KWW",
    "...K...",
    "...W...",
    "...W..."
   ]
  ]
 },
 "crown": {
  "w": 7,
  "h": 5,
  "frames": [
   [
    "y.y.y.y",
    "yyyyyyy",
    "yoyoyoy",
    "yyyyyyy",
    "ooooooo"
   ]
  ]
 },
 "card": {
  "w": 14,
  "h": 9,
  "frames": [
   [
    "KKKKKKKKKKKKKK",
    "KwwwwwwwwwwwwK",
    "KwwwwwwwwwwwwK",
    "KwwwwwwwwwwwwK",
    "KwwwwwwwwwwwwK",
    "KKKKKKKKKKKKKK",
    "......KK......",
    "......KK......",
    "......KK......"
   ]
  ]
 },
 "pose_one": {
  "w": 16,
  "h": 16,
  "frames": [
   [
    "......KK........",
    ".....KttK.......",
    ".....KttK.......",
    ".....KttK.......",
    ".....KttKKKKKKKK",
    "....KttttttttttK",
    "...KttttttttttK.",
    "...KttttKKKKKK..",
    "...KtttttttK....",
    "...KtKtKtKtK....",
    "...KttttttttK...",
    "....KtttttttK...",
    ".....KtttttK....",
    "......KtttK.....",
    "......KtttK.....",
    "......KKKKK....."
   ]
  ]
 },
 "pose_two": {
  "w": 16,
  "h": 16,
  "frames": [
   [
    "......KK........",
    ".....KttK.......",
    ".....KttK.......",
    ".....KttKKKKKKKK",
    "....KttttttttttK",
    "...KttttttttttK.",
    "...KttttKKKKKK..",
    "..KKtttttttK....",
    ".KTTKtKtKtKK....",
    ".KTTTKttttK.....",
    ".KTTTTKtttK.....",
    "..KTTTTKKKK.....",
    "...KTTTTTTK.....",
    "....KTTTTK......",
    ".....KTTK.......",
    ".....KKKK......."
   ]
  ]
 }
};
