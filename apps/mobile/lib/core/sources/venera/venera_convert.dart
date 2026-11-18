import 'dart:convert';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';

import 'venera_aes.dart';
import 'venera_models.dart';

Uint8List _bytes(Object? value) => Uint8List.fromList(base64Decode('${value ?? ''}'));

String _b64(List<int> bytes) => base64Encode(bytes);

Hash _hash(String? name) {
  switch (name) {
    case 'md5':
      return md5;
    case 'sha1':
      return sha1;
    case 'sha256':
      return sha256;
    case 'sha512':
      return sha512;
  }
  throw VeneraException('不支持的哈希算法：$name');
}

Object veneraConvert(Map<String, dynamic> data) {
  final type = data['type'];
  final isEncode = data['isEncode'] == true;
  switch (type) {
    case 'utf8':
      return isEncode
          ? _b64(utf8.encode('${data['value']}'))
          : utf8.decode(_bytes(data['value']), allowMalformed: true);
    case 'md5':
    case 'sha1':
    case 'sha256':
    case 'sha512':
      return _b64(_hash('$type').convert(_bytes(data['value'])).bytes);
    case 'hmac':
      final digest = Hmac(_hash('${data['hash']}'.toLowerCase()), _bytes(data['key'])).convert(_bytes(data['value']));
      return data['isString'] == true ? digest.toString() : _b64(digest.bytes);
    case 'aes-ecb':
      final aes = VeneraAes(_bytes(data['key']));
      return _b64(aes.ecb(_bytes(data['value']), encrypt: isEncode));
    case 'aes-cbc':
      final aes = VeneraAes(_bytes(data['key']));
      return _b64(aes.cbc(_bytes(data['value']), _bytes(data['iv']), encrypt: isEncode));
  }
  throw VeneraException('需要宿主能力：Convert.$type');
}
