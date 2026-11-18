import 'package:html/dom.dart' as dom;
import 'package:html/parser.dart' as html_parser;

import 'venera_models.dart';

class VeneraDocument {
  VeneraDocument(String source) : doc = html_parser.parse(source);

  final dom.Document doc;
  final List<dom.Element> _elements = [];
  final List<dom.Node> _nodes = [];

  int _element(dom.Element element) {
    _elements.add(element);
    return _elements.length - 1;
  }

  int _node(dom.Node node) {
    _nodes.add(node);
    return _nodes.length - 1;
  }

  dom.Element _at(Object? key) {
    final index = key is num ? key.toInt() : -1;
    if (index < 0 || index >= _elements.length) throw const VeneraException('无效的 HTML 元素句柄');
    return _elements[index];
  }

  dom.Node _nodeAt(Object? key) {
    final index = key is num ? key.toInt() : -1;
    if (index < 0 || index >= _nodes.length) throw const VeneraException('无效的 HTML 节点句柄');
    return _nodes[index];
  }

  Object? handle(String function, Map<String, dynamic> data) {
    switch (function) {
      case 'querySelector':
        final found = doc.querySelector('${data['query']}');
        return found == null ? null : _element(found);
      case 'querySelectorAll':
        return [for (final e in doc.querySelectorAll('${data['query']}')) _element(e)];
      case 'getElementById':
        final found = doc.getElementById('${data['id']}');
        return found == null ? null : _element(found);
      case 'getText':
        return _at(data['key']).text;
      case 'getAttributes':
        return _at(data['key']).attributes.map((k, v) => MapEntry(k.toString(), v));
      case 'dom_querySelector':
        final found = _at(data['key']).querySelector('${data['query']}');
        return found == null ? null : _element(found);
      case 'dom_querySelectorAll':
        return [for (final e in _at(data['key']).querySelectorAll('${data['query']}')) _element(e)];
      case 'getChildren':
        return [for (final e in _at(data['key']).children) _element(e)];
      case 'getNodes':
        return [for (final n in _at(data['key']).nodes) _node(n)];
      case 'getInnerHTML':
        return _at(data['key']).innerHtml;
      case 'getParent':
        final parent = _at(data['key']).parent;
        return parent is dom.Element ? _element(parent) : null;
      case 'getClassNames':
        return _at(data['key']).classes.toList();
      case 'getId':
        return _at(data['key']).id;
      case 'getLocalName':
        return _at(data['key']).localName;
      case 'getPreviousSibling':
        final sibling = _at(data['key']).previousElementSibling;
        return sibling == null ? null : _element(sibling);
      case 'getNextSibling':
        final sibling = _at(data['key']).nextElementSibling;
        return sibling == null ? null : _element(sibling);
      case 'node_text':
        return _nodeAt(data['key']).text;
      case 'node_type':
        return switch (_nodeAt(data['key']).nodeType) {
          dom.Node.ELEMENT_NODE => 'element',
          dom.Node.TEXT_NODE => 'text',
          dom.Node.COMMENT_NODE => 'comment',
          dom.Node.DOCUMENT_NODE => 'document',
          _ => 'unknown',
        };
      case 'node_to_element':
        final node = _nodeAt(data['key']);
        return node is dom.Element ? _element(node) : null;
    }
    throw VeneraException('需要宿主能力：HtmlDocument.$function');
  }
}

class VeneraHtmlRegistry {
  VeneraHtmlRegistry({this.maxDocuments = 16});

  final int maxDocuments;
  final Map<int, VeneraDocument> _documents = {};

  int get count => _documents.length;

  Object? handle(String function, Map<String, dynamic> data) {
    if (function == 'parse') {
      if (_documents.length >= maxDocuments) {
        _documents.remove(_documents.keys.first);
      }
      _documents[(data['key'] as num).toInt()] = VeneraDocument('${data['data']}');
      return null;
    }
    if (function == 'dispose') {
      _documents.remove((data['key'] as num).toInt());
      return null;
    }
    final docKey = (data['doc'] ?? data['key']) as num;
    final document = _documents[docKey.toInt()];
    if (document == null) throw const VeneraException('HtmlDocument 已被释放');
    return document.handle(function, data);
  }

  void clear() => _documents.clear();
}
