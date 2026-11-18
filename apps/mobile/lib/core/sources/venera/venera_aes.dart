import 'dart:typed_data';

class VeneraAes {
  VeneraAes(Uint8List key) : _rounds = _roundsFor(key.length) {
    _roundKeys = _expandKey(key);
  }

  static const int blockSize = 16;

  static final Uint8List _sbox = _buildSbox();
  static final Uint8List _invSbox = _buildInvSbox(_sbox);

  final int _rounds;
  late final List<Uint8List> _roundKeys;

  static int _roundsFor(int keyLength) {
    switch (keyLength) {
      case 16:
        return 10;
      case 24:
        return 12;
      case 32:
        return 14;
    }
    throw ArgumentError('AES 密钥长度必须为 16/24/32 字节');
  }

  static int _xtime(int value) => ((value << 1) ^ (((value >> 7) & 1) * 0x1b)) & 0xff;

  static int _mul(int a, int b) {
    var result = 0;
    var x = a;
    var y = b;
    while (y > 0) {
      if (y & 1 == 1) result ^= x;
      x = _xtime(x);
      y >>= 1;
    }
    return result;
  }

  static Uint8List _buildSbox() {
    final sbox = Uint8List(256);
    var p = 1;
    var q = 1;
    do {
      p = p ^ _xtime(p);
      q ^= q << 1;
      q ^= q << 2;
      q ^= q << 4;
      q &= 0xff;
      if (q & 0x80 != 0) q ^= 0x09;
      final x = q ^ _rotl8(q, 1) ^ _rotl8(q, 2) ^ _rotl8(q, 3) ^ _rotl8(q, 4);
      sbox[p] = (x ^ 0x63) & 0xff;
    } while (p != 1);
    sbox[0] = 0x63;
    return sbox;
  }

  static int _rotl8(int value, int shift) => ((value << shift) | (value >> (8 - shift))) & 0xff;

  static Uint8List _buildInvSbox(Uint8List sbox) {
    final inverse = Uint8List(256);
    for (var i = 0; i < 256; i++) {
      inverse[sbox[i]] = i;
    }
    return inverse;
  }

  List<Uint8List> _expandKey(Uint8List key) {
    final nk = key.length ~/ 4;
    final words = <Uint8List>[
      for (var i = 0; i < nk; i++) Uint8List.fromList(key.sublist(i * 4, i * 4 + 4)),
    ];
    var rcon = 1;
    for (var i = nk; i < 4 * (_rounds + 1); i++) {
      final temp = Uint8List.fromList(words[i - 1]);
      if (i % nk == 0) {
        final first = temp[0];
        temp[0] = _sbox[temp[1]] ^ rcon;
        temp[1] = _sbox[temp[2]];
        temp[2] = _sbox[temp[3]];
        temp[3] = _sbox[first];
        rcon = _xtime(rcon);
      } else if (nk > 6 && i % nk == 4) {
        for (var j = 0; j < 4; j++) {
          temp[j] = _sbox[temp[j]];
        }
      }
      final word = Uint8List(4);
      for (var j = 0; j < 4; j++) {
        word[j] = words[i - nk][j] ^ temp[j];
      }
      words.add(word);
    }
    return [
      for (var round = 0; round <= _rounds; round++)
        Uint8List.fromList([for (var c = 0; c < 4; c++) ...words[round * 4 + c]]),
    ];
  }

  void _addRoundKey(Uint8List state, int round) {
    final key = _roundKeys[round];
    for (var i = 0; i < 16; i++) {
      state[i] ^= key[i];
    }
  }

  void _subBytes(Uint8List state, Uint8List box) {
    for (var i = 0; i < 16; i++) {
      state[i] = box[state[i]];
    }
  }

  void _shiftRows(Uint8List state, {required bool inverse}) {
    final copy = Uint8List.fromList(state);
    for (var row = 1; row < 4; row++) {
      for (var col = 0; col < 4; col++) {
        final from = inverse ? (col - row) & 3 : (col + row) & 3;
        state[col * 4 + row] = copy[from * 4 + row];
      }
    }
  }

  void _mixColumns(Uint8List state, {required bool inverse}) {
    final a = inverse ? const [14, 11, 13, 9] : const [2, 3, 1, 1];
    for (var col = 0; col < 4; col++) {
      final c = [for (var r = 0; r < 4; r++) state[col * 4 + r]];
      for (var r = 0; r < 4; r++) {
        state[col * 4 + r] = _mul(c[0], a[(4 - r) & 3]) ^
            _mul(c[1], a[(5 - r) & 3]) ^
            _mul(c[2], a[(6 - r) & 3]) ^
            _mul(c[3], a[(7 - r) & 3]);
      }
    }
  }

  Uint8List encryptBlock(Uint8List input) {
    final state = Uint8List.fromList(input);
    _addRoundKey(state, 0);
    for (var round = 1; round < _rounds; round++) {
      _subBytes(state, _sbox);
      _shiftRows(state, inverse: false);
      _mixColumns(state, inverse: false);
      _addRoundKey(state, round);
    }
    _subBytes(state, _sbox);
    _shiftRows(state, inverse: false);
    _addRoundKey(state, _rounds);
    return state;
  }

  Uint8List decryptBlock(Uint8List input) {
    final state = Uint8List.fromList(input);
    _addRoundKey(state, _rounds);
    for (var round = _rounds - 1; round >= 1; round--) {
      _shiftRows(state, inverse: true);
      _subBytes(state, _invSbox);
      _addRoundKey(state, round);
      _mixColumns(state, inverse: true);
    }
    _shiftRows(state, inverse: true);
    _subBytes(state, _invSbox);
    _addRoundKey(state, 0);
    return state;
  }

  static void _requireBlocks(Uint8List data) {
    if (data.length % blockSize != 0) {
      throw ArgumentError('AES 数据长度必须是 16 的倍数');
    }
  }

  Uint8List ecb(Uint8List data, {required bool encrypt}) {
    _requireBlocks(data);
    final out = Uint8List(data.length);
    for (var offset = 0; offset < data.length; offset += blockSize) {
      final block = Uint8List.sublistView(data, offset, offset + blockSize);
      out.setRange(offset, offset + blockSize, encrypt ? encryptBlock(block) : decryptBlock(block));
    }
    return out;
  }

  Uint8List cbc(Uint8List data, Uint8List iv, {required bool encrypt}) {
    _requireBlocks(data);
    if (iv.length != blockSize) throw ArgumentError('AES IV 必须为 16 字节');
    final out = Uint8List(data.length);
    var previous = Uint8List.fromList(iv);
    for (var offset = 0; offset < data.length; offset += blockSize) {
      final block = Uint8List.fromList(data.sublist(offset, offset + blockSize));
      if (encrypt) {
        for (var i = 0; i < blockSize; i++) {
          block[i] ^= previous[i];
        }
        final cipher = encryptBlock(block);
        out.setRange(offset, offset + blockSize, cipher);
        previous = cipher;
      } else {
        final plain = decryptBlock(block);
        for (var i = 0; i < blockSize; i++) {
          plain[i] ^= previous[i];
        }
        out.setRange(offset, offset + blockSize, plain);
        previous = block;
      }
    }
    return out;
  }
}
