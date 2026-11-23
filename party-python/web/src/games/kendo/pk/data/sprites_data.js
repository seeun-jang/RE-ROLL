window.PK_SPRITE_DATA = {
  "_comment": "픽셀 검도 스프라이트 데이터. '=' 뒤는 순수 JSON (tools/export_sprites.py 가 읽음). 문자 하나 = 픽셀 하나, charMap 으로 팔레트 인덱스에 대응. '.' = 투명. 모든 스프라이트는 오른쪽을 바라보는 기준.",
  "palette": [
    "#be4a2f", "#d77643", "#ead4aa", "#e4a672", "#b86f50", "#733e39", "#3e2731", "#a22633",
    "#e43b44", "#f77622", "#feae34", "#fee761", "#63c74d", "#3e8948", "#265c42", "#193c3e",
    "#124e89", "#0099db", "#2ce8f5", "#ffffff", "#c0cbdc", "#8b9bb4", "#5a6988", "#3a4466",
    "#262b44", "#181425", "#ff0044", "#68386c", "#b55088", "#f6757a", "#e8b796", "#c28569"
  ],
  "charMap": {
    ".": -1,
    "K": 25, "N": 24, "B": 23, "b": 22,
    "H": 23, "h": 22, "n": 24,
    "G": 21, "g": 20, "W": 19,
    "S": 30, "s": 31,
    "D": 6, "d": 5, "w": 4, "u": 1, "v": 0,
    "C": 2, "c": 3,
    "Y": 10, "y": 11, "O": 9,
    "R": 8, "r": 7, "E": 8, "e": 7,
    "P": 27, "p": 28, "i": 29,
    "Q": 16, "q": 17, "T": 15,
    "L": 13, "l": 12, "J": 14, "F": 26
  },
  "named": {
    "outline": 25, "navyDark": 24, "navy": 23, "navyLight": 22, "grey": 21, "lgrey": 20, "white": 19,
    "skin": 30, "skinShadow": 31, "plum": 6, "brown": 5, "wood": 4, "rust": 0, "orangeBrown": 1,
    "cream": 2, "tan": 3, "gold": 10, "yellow": 11, "orange": 9, "red": 8, "darkRed": 7,
    "purple": 27, "magenta": 28, "pink": 29, "blue": 16, "sky": 17, "cyan": 18,
    "green": 12, "darkGreen": 13, "forest": 14, "teal": 15, "crimson": 26
  },
  "swaps": {
    "red": {},
    "white": { "R": 19, "r": 20 },
    "sensei": { "R": 19, "r": 20, "H": 20, "h": 19, "n": 21 },
    "rival": { "R": 19, "r": 20, "H": 24, "h": 23, "n": 25 },
    "uiGrey": { "Y": 21, "y": 20 },
    "uiPaper": { "Y": 5, "y": 4, "N": 2 },
    "club": { "N": 5, "b": 1 }
  },
  "sprites": {
    "torso": {
      "anchor": [8, 18],
      "rows": [
        "......KKKKK.....",
        "....KKBBbbBKK...",
        "...KBbBBBBbBGK..",
        "..KBBBBBBBBKgGK.",
        "..KBBBBBBBKGsgGK",
        ".KbBBBBBBBKgKgGK",
        ".KbBBBBBBBKGsgGK",
        ".KbNBBBBBBKgKgK.",
        ".KbNNBBBBBKGgGK.",
        "..KNNBBBBBBKKK..",
        "..KNHHBbYbYYK...",
        ".KNHHHBDdddddK..",
        "KrRHHHDddcdddK..",
        "KRRHHHDddcddK...",
        ".KrHHHDdddddK...",
        "..KHHHDDdddDK...",
        "..KnHHHDDDDK....",
        "..KnnHHHHHK....."
      ]
    },
    "torso_lean": { "from": "torso", "shear": [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0] },
    "torso_bent": { "from": "torso", "shear": [2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0] },
    "torso_back": { "from": "torso", "shear": [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 0, 0, 0, 0, 0, 0, 0, 0] },
    "legs_stand": {
      "anchor": [10, 14],
      "rows": [
        "....KNBBBBBBBBK.....",
        "....KNbBbBbBCCK.....",
        "....KNBBBBBBCCK.....",
        "....KNbBbBbBBBK.....",
        "....KnHHHHHHHHHK....",
        "....KnHHHnHHHHHK....",
        "...KnHHHHnHHHHHHK...",
        "...KnHHHnnHHHHHHK...",
        "...KnHHHnKnHHHHHK...",
        "..KnHHHHnKnHHHHHHK..",
        "..KnHHHnK.KnHHHHHK..",
        "..KnnnnK...KnnnnnK..",
        "...KsSK.....KSSSSK..",
        "....KK......KKKKK..."
      ]
    },
    "legs_stepA": {
      "anchor": [10, 14],
      "rows": [
        "....KNBBBBBBBBK.....",
        "....KNbBbBbBCCK.....",
        "....KNBBBBBBCCK.....",
        "....KNbBbBbBBBK.....",
        "....KnHHHHHHHHHK....",
        "...KnHHHHnHHHHHHK...",
        "...KnHHHHnHHHHHHHK..",
        "..KnHHHHnnHHHHHHHK..",
        "..KnHHHnK.KnHHHHHHK.",
        ".KnHHHnK...KnHHHHHK.",
        ".KnHHnK.....KnHHHHK.",
        ".KnnnK.......KnnnnK.",
        "KsSK.........KSSSSK.",
        ".KK..........KKKKK.."
      ]
    },
    "legs_stepB": {
      "anchor": [10, 14],
      "rows": [
        "....KNBBBBBBBBK.....",
        "....KNbBbBbBCCK.....",
        "....KNBBBBBBCCK.....",
        "....KNbBbBbBBBK.....",
        "....KnHHHHHHHHHK....",
        "....KnHHHHnHHHHK....",
        "....KnHHHHnHHHHHK...",
        "...KnHHHHnHHHHHHK...",
        "...KnHHHnKnHHHHHK...",
        "...KnHHHnKnHHHHHK...",
        "...KnHHnK.KnHHHHK...",
        "...KnnnK..KnnnnnK...",
        "....KsSK..KSSSSK....",
        ".....KK...KKKKK....."
      ]
    },
    "legs_stomp": {
      "anchor": [10, 14],
      "rows": [
        "....KNBBBBBBBBK.....",
        "....KNbBbBbBCCK.....",
        "....KNBBBBBBCCK.....",
        "....KNbBbBbBBBK.....",
        "...KnHHHHHHHHHHK....",
        "..KnHHHHHnHHHHHHK...",
        ".KnHHHHHnKnHHHHHHK..",
        ".KnHHHHnK.KnHHHHHHK.",
        "KnHHHHnK...KnHHHHHK.",
        "KnHHHnK.....KnHHHHHK",
        "KnHHnK.......KnHHHHK",
        "KnnnK.........KnnnnK",
        "KsSK..........KSSSSK",
        "KK.............KKKK."
      ]
    },
    "legs_crouch": {
      "anchor": [10, 9],
      "rows": [
        "....KNBBBBBBBBK.....",
        "....KNbBbBbBCCK.....",
        "....KNBBBBBBCCKKK...",
        "...KnHHHHHHHHHHHHK..",
        "...KnHHHHHHHHHHHHHK.",
        "...KnHHHnnnnnHHHHHK.",
        "...KnHHKKKKKKnnnnK..",
        "...KsSSK............",
        "....KKK............."
      ]
    },
    "referee": {
      "anchor": [8, 26],
      "rows": [
        "......KKKK......",
        ".....KNNNNK.....",
        "....KNNNNNNK....",
        "....KNSSSSNK....",
        "....KSKSSKSK....",
        "....KSSSSSSK....",
        ".....KSssSK.....",
        "......KSSK......",
        "...KKBBWWBBKK...",
        "..KBBBBWEWBBBK..",
        "..KBBBBWEWBBBK..",
        "..KBBBBBEBBBBK..",
        "..KBBBBBBBBBBK..",
        "..KBBBBBBBBBBK..",
        "..KBBBBBYBBBBK..",
        "..KBBBBBBBBBBK..",
        "...KGGGGGGGGK...",
        "...KGGGGgGGGK...",
        "...KGGGKKGGGK...",
        "...KGGGKKGGGK...",
        "...KGGGKKGGGK...",
        "...KGGGKKGGGK...",
        "...KGGGKKGGGK...",
        "...KGGgKKgGGK...",
        "...KGGGKKGGGK...",
        "..KKKKK..KKKKK.."
      ]
    },
    "portrait_sensei": {
      "rows": [
        "........KKKKKKK.........",
        "......KKgggggggKK.......",
        ".....KggWWgggggggK......",
        "....KgWggggggggggGK.....",
        "....KggggGGGGGgggGK.....",
        "...KgGSSSSSSSSSSSGgK....",
        "...KGSSSSSSSSSSSSSGK....",
        "...KSgggSSSSSSgggSSK....",
        "...KSKKSSSSSSSKKSSSK....",
        "...KSSSSSSSsSSSSSSSK....",
        "...KsSSSSSSsSSSSSSsK....",
        "....KSSSSSssSSSSSSK.....",
        "....KSSggggggggSSSK.....",
        "....KSSSSsKKsSSSSSK.....",
        ".....KsSSSSSSSSSSK......",
        "......KssSSSSSSssK......",
        ".......KKsSSSSsKK.......",
        "......KHHKssssKHHK......",
        "....KKHHHHKSSKHHHHKK....",
        "...KHHHHHHHKKHHHHHHHK...",
        "..KHHHHHHHHhhHHHHHHHHK..",
        "..KHHHHHHHHhhHHHHHHHHK..",
        ".KHHHHHHHHHhhHHHHHHHHHK.",
        ".KHHHHHHHHHhhHHHHHHHHHK."
      ]
    },
    "portrait_hero": {
      "rows": [
        "........KKKKKKK.........",
        "......KKNNNNNNNKK.......",
        ".....KNNbNNNNNNNNK......",
        "....KNNNNNNNNNNNNNK.....",
        "....KNNNNNNNNNNNNNK.....",
        "...KNNNSSSNNNSSSNNNK....",
        "...KNSSSSSSSSSSSSSNK....",
        "...KNSKKSSSSSSKKSSNK....",
        "...KSSWKSSSSSSWKSSSK....",
        "...KSSKKSSSSSSKKSSSK....",
        "...KsSSSSSSsSSSSSSsK....",
        "....KSSSSSssSSSSSSK.....",
        "....KSSSSSSSSSSSSSK.....",
        "....KSSSSKKKKSSSSSK.....",
        ".....KsSSSSSSSSSSK......",
        "......KssSSSSSSssK......",
        ".......KKsSSSSsKK.......",
        "......KHHKssssKHHK......",
        "....KKHHHHKSSKHHHHKK....",
        "...KHHHHHHHKKHHHHHHHK...",
        "..KHHHHHHHHhhHHHHHHHHK..",
        "..KHHHHHHHHhhHHHHHHHHK..",
        ".KHHHHHHHHHhhHHHHHHHHHK.",
        ".KHHHHHHHHHhhHHHHHHHHHK."
      ]
    },
    "portrait_club": {
      "rows": [
        "........KKKKKKK.........",
        "......KKNNNNNNNKK.......",
        ".....KNNbNNNNNNNNK......",
        "....KNNNNNNNNNNNNNK.....",
        "....KNNNNNNNNNNNNNNK....",
        "...KNNNSSSNNNSSSNNNNK...",
        "...KNSSSSSSSSSSSSSNNK...",
        "...KNSKKSSSSSSKKSSNNK...",
        "...KSGGGGGGSGGGGGGSNK...",
        "...KSGWKSGSSGWKSGSNNK...",
        "...KSGGGGGGSGGGGGGSNK...",
        "....KSSSSSssSSSSSSKNK...",
        "....KSSSSSSSSSSSSSKNK...",
        "....KSSSSSKKSSSSSSKK....",
        ".....KsSSSSSSSSSSK......",
        "......KssSSSSSSssK......",
        ".......KKsSSSSsKK.......",
        "......KHHKssssKHHK......",
        "....KKHHHHKSSKHHHHKK....",
        "...KHHHHHHHKKHHHHHHHK...",
        "..KHHHHHHHHhhHHHHHHHHK..",
        "..KHHHHHHHHhhHHHHHHHHK..",
        ".KHHHHHHHHHhhHHHHHHHHHK.",
        ".KHHHHHHHHHhhHHHHHHHHHK."
      ]
    },
    "portrait_men": {
      "rows": [
        "......KKKKKKKKKKK.......",
        ".....KBBBBbBBBBBBK......",
        "....KBBbBBBBBBBbBBK.....",
        "...KBBBBBBBBBBBBBBBK....",
        "...KBBKKKKKKKKKKKBBK....",
        "..KBBKGgGgGgGgGgGKBBK...",
        "..KBBKgKKKKKKKKKgKBBK...",
        "..KBBKGsSsSsSsSsGKBBK...",
        "..KBBKgKKKKKKKKKgKBBK...",
        "..KBBKGsSsSsSsSsGKBBK...",
        "..KBBKgKKKKKKKKKgKBBK...",
        "..KBBKGgGgGgGgGgGKBBK...",
        "..KBBBKGgGgGgGgGKBBBK...",
        ".KBbBBBKKKKKKKKKBBBbBK..",
        ".KBBBBBBBBBBBBBBBBBBBK..",
        "KBBbBBBBBBBBBBBBBBBbBBK.",
        "KBBBBBBBBBBBBBBBBBBBBBK.",
        "KBbBBBBDDDDDDDDBBBBbBBK.",
        "KBBBBBDddddddddDBBBBBBK.",
        "KBBBBDddYYYYYYddDBBBBBK.",
        ".KBBBDddddddddddDBBBBK..",
        ".KBBDddddcddddddDDBBBK..",
        "..KKDddddcdddddddDKKK...",
        "...KDdddddddddddddDK...."
      ]
    },
    "ui_box": {
      "rows": [
        ".KKKKKKK.",
        "KYYYYYYYK",
        "KYNNNNNyK",
        "KYNNNNNyK",
        "KYNNNNNyK",
        "KYNNNNNyK",
        "KYNNNNNyK",
        "KYyyyyyyK",
        ".KKKKKKK."
      ]
    },
    "ui_box_dark": {
      "rows": [
        ".KKKKKKK.",
        "KbbbbbbbK",
        "KbKKKKKNK",
        "KbKKKKKNK",
        "KbKKKKKNK",
        "KbKKKKKNK",
        "KbKKKKKNK",
        "KbNNNNNNK",
        ".KKKKKKK."
      ]
    },
    "ui_box_paper": {
      "rows": [
        ".KKKKKKK.",
        "KddddddDK",
        "KdCCCCCcK",
        "KdCCCCCcK",
        "KdCCCCCcK",
        "KdCCCCCcK",
        "KdCCCCCcK",
        "KDccccccK",
        ".KKKKKKK."
      ]
    },
    "icon_point": {
      "rows": [
        "...KKKKK...",
        ".KKRRRRRKK.",
        ".KRRRRRRRK.",
        "KRRRRRRRRrK",
        "KRRRRRRRRrK",
        "KRRRRRRRRrK",
        "KRRRRRRRRrK",
        "KRRRRRRRRrK",
        ".KRRRRRRrK.",
        ".KKrrrrrKK.",
        "...KKKKK..."
      ]
    },
    "icon_point_empty": {
      "rows": [
        "...KKKKK...",
        ".KKNNNNNKK.",
        ".KNKKKKKNK.",
        "KNKKKKKKKNK",
        "KNKKKKKKKNK",
        "KNKKKKKKKNK",
        "KNKKKKKKKNK",
        "KNKKKKKKKNK",
        ".KNKKKKKNK.",
        ".KKNNNNNKK.",
        "...KKKKK..."
      ]
    },
    "icon_hansoku": {
      "rows": [
        "...K...",
        "..KYK..",
        "..KYK..",
        ".KYYYK.",
        ".KYyYK.",
        "KYYYYYK",
        "KKKKKKK"
      ]
    },
    "icon_arrow": {
      "rows": [
        "K....",
        "KYK..",
        "KYYK.",
        "KYYYK",
        "KYYK.",
        "KYK..",
        "K...."
      ]
    }
  }
};
