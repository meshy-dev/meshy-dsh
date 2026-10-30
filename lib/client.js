window.__ModuleLoader__.load({ id: "meshy-dsh", factory: (require) => {

var module = { exports: {} }; var exports = module.exports;
Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
let react = require("react");
let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
let react_jsx_runtime = require("react/jsx-runtime");

// node_modules/qrcode-generator/dist/qrcode.mjs
/**
* qrcode
* @param typeNumber 1 to 40
* @param errorCorrectionLevel 'L','M','Q','H'
*/
const qrcode = function(typeNumber, errorCorrectionLevel) {
	const PAD0 = 236;
	const PAD1 = 17;
	let _typeNumber = typeNumber;
	const _errorCorrectionLevel = QRErrorCorrectionLevel[errorCorrectionLevel];
	let _modules = null;
	let _moduleCount = 0;
	let _dataCache = null;
	const _dataList = [];
	const _this = {};
	const makeImpl = function(test, maskPattern) {
		_moduleCount = _typeNumber * 4 + 17;
		_modules = function(moduleCount) {
			const modules = new Array(moduleCount);
			for (let row = 0; row < moduleCount; row += 1) {
				modules[row] = new Array(moduleCount);
				for (let col = 0; col < moduleCount; col += 1) modules[row][col] = null;
			}
			return modules;
		}(_moduleCount);
		setupPositionProbePattern(0, 0);
		setupPositionProbePattern(_moduleCount - 7, 0);
		setupPositionProbePattern(0, _moduleCount - 7);
		setupPositionAdjustPattern();
		setupTimingPattern();
		setupTypeInfo(test, maskPattern);
		if (_typeNumber >= 7) setupTypeNumber(test);
		if (_dataCache == null) _dataCache = createData(_typeNumber, _errorCorrectionLevel, _dataList);
		mapData(_dataCache, maskPattern);
	};
	const setupPositionProbePattern = function(row, col) {
		for (let r = -1; r <= 7; r += 1) {
			if (row + r <= -1 || _moduleCount <= row + r) continue;
			for (let c = -1; c <= 7; c += 1) {
				if (col + c <= -1 || _moduleCount <= col + c) continue;
				if (0 <= r && r <= 6 && (c == 0 || c == 6) || 0 <= c && c <= 6 && (r == 0 || r == 6) || 2 <= r && r <= 4 && 2 <= c && c <= 4) _modules[row + r][col + c] = true;
				else _modules[row + r][col + c] = false;
			}
		}
	};
	const getBestMaskPattern = function() {
		let minLostPoint = 0;
		let pattern = 0;
		for (let i = 0; i < 8; i += 1) {
			makeImpl(true, i);
			const lostPoint = QRUtil.getLostPoint(_this);
			if (i == 0 || minLostPoint > lostPoint) {
				minLostPoint = lostPoint;
				pattern = i;
			}
		}
		return pattern;
	};
	const setupTimingPattern = function() {
		for (let r = 8; r < _moduleCount - 8; r += 1) {
			if (_modules[r][6] != null) continue;
			_modules[r][6] = r % 2 == 0;
		}
		for (let c = 8; c < _moduleCount - 8; c += 1) {
			if (_modules[6][c] != null) continue;
			_modules[6][c] = c % 2 == 0;
		}
	};
	const setupPositionAdjustPattern = function() {
		const pos = QRUtil.getPatternPosition(_typeNumber);
		for (let i = 0; i < pos.length; i += 1) for (let j = 0; j < pos.length; j += 1) {
			const row = pos[i];
			const col = pos[j];
			if (_modules[row][col] != null) continue;
			for (let r = -2; r <= 2; r += 1) for (let c = -2; c <= 2; c += 1) if (r == -2 || r == 2 || c == -2 || c == 2 || r == 0 && c == 0) _modules[row + r][col + c] = true;
			else _modules[row + r][col + c] = false;
		}
	};
	const setupTypeNumber = function(test) {
		const bits = QRUtil.getBCHTypeNumber(_typeNumber);
		for (let i = 0; i < 18; i += 1) {
			const mod = !test && (bits >> i & 1) == 1;
			_modules[Math.floor(i / 3)][i % 3 + _moduleCount - 8 - 3] = mod;
		}
		for (let i = 0; i < 18; i += 1) {
			const mod = !test && (bits >> i & 1) == 1;
			_modules[i % 3 + _moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
		}
	};
	const setupTypeInfo = function(test, maskPattern) {
		const data = _errorCorrectionLevel << 3 | maskPattern;
		const bits = QRUtil.getBCHTypeInfo(data);
		for (let i = 0; i < 15; i += 1) {
			const mod = !test && (bits >> i & 1) == 1;
			if (i < 6) _modules[i][8] = mod;
			else if (i < 8) _modules[i + 1][8] = mod;
			else _modules[_moduleCount - 15 + i][8] = mod;
		}
		for (let i = 0; i < 15; i += 1) {
			const mod = !test && (bits >> i & 1) == 1;
			if (i < 8) _modules[8][_moduleCount - i - 1] = mod;
			else if (i < 9) _modules[8][15 - i - 1 + 1] = mod;
			else _modules[8][15 - i - 1] = mod;
		}
		_modules[_moduleCount - 8][8] = !test;
	};
	const mapData = function(data, maskPattern) {
		let inc = -1;
		let row = _moduleCount - 1;
		let bitIndex = 7;
		let byteIndex = 0;
		const maskFunc = QRUtil.getMaskFunction(maskPattern);
		for (let col = _moduleCount - 1; col > 0; col -= 2) {
			if (col == 6) col -= 1;
			while (true) {
				for (let c = 0; c < 2; c += 1) if (_modules[row][col - c] == null) {
					let dark = false;
					if (byteIndex < data.length) dark = (data[byteIndex] >>> bitIndex & 1) == 1;
					if (maskFunc(row, col - c)) dark = !dark;
					_modules[row][col - c] = dark;
					bitIndex -= 1;
					if (bitIndex == -1) {
						byteIndex += 1;
						bitIndex = 7;
					}
				}
				row += inc;
				if (row < 0 || _moduleCount <= row) {
					row -= inc;
					inc = -inc;
					break;
				}
			}
		}
	};
	const createBytes = function(buffer, rsBlocks) {
		let offset = 0;
		let maxDcCount = 0;
		let maxEcCount = 0;
		const dcdata = new Array(rsBlocks.length);
		const ecdata = new Array(rsBlocks.length);
		for (let r = 0; r < rsBlocks.length; r += 1) {
			const dcCount = rsBlocks[r].dataCount;
			const ecCount = rsBlocks[r].totalCount - dcCount;
			maxDcCount = Math.max(maxDcCount, dcCount);
			maxEcCount = Math.max(maxEcCount, ecCount);
			dcdata[r] = new Array(dcCount);
			for (let i = 0; i < dcdata[r].length; i += 1) dcdata[r][i] = 255 & buffer.getBuffer()[i + offset];
			offset += dcCount;
			const rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
			const modPoly = qrPolynomial(dcdata[r], rsPoly.getLength() - 1).mod(rsPoly);
			ecdata[r] = new Array(rsPoly.getLength() - 1);
			for (let i = 0; i < ecdata[r].length; i += 1) {
				const modIndex = i + modPoly.getLength() - ecdata[r].length;
				ecdata[r][i] = modIndex >= 0 ? modPoly.getAt(modIndex) : 0;
			}
		}
		let totalCodeCount = 0;
		for (let i = 0; i < rsBlocks.length; i += 1) totalCodeCount += rsBlocks[i].totalCount;
		const data = new Array(totalCodeCount);
		let index = 0;
		for (let i = 0; i < maxDcCount; i += 1) for (let r = 0; r < rsBlocks.length; r += 1) if (i < dcdata[r].length) {
			data[index] = dcdata[r][i];
			index += 1;
		}
		for (let i = 0; i < maxEcCount; i += 1) for (let r = 0; r < rsBlocks.length; r += 1) if (i < ecdata[r].length) {
			data[index] = ecdata[r][i];
			index += 1;
		}
		return data;
	};
	const createData = function(typeNumber, errorCorrectionLevel, dataList) {
		const rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectionLevel);
		const buffer = qrBitBuffer();
		for (let i = 0; i < dataList.length; i += 1) {
			const data = dataList[i];
			buffer.put(data.getMode(), 4);
			buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber));
			data.write(buffer);
		}
		let totalDataCount = 0;
		for (let i = 0; i < rsBlocks.length; i += 1) totalDataCount += rsBlocks[i].dataCount;
		if (buffer.getLengthInBits() > totalDataCount * 8) throw "code length overflow. (" + buffer.getLengthInBits() + ">" + totalDataCount * 8 + ")";
		if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) buffer.put(0, 4);
		while (buffer.getLengthInBits() % 8 != 0) buffer.putBit(false);
		while (true) {
			if (buffer.getLengthInBits() >= totalDataCount * 8) break;
			buffer.put(PAD0, 8);
			if (buffer.getLengthInBits() >= totalDataCount * 8) break;
			buffer.put(PAD1, 8);
		}
		return createBytes(buffer, rsBlocks);
	};
	_this.addData = function(data, mode) {
		mode = mode || "Byte";
		let newData = null;
		switch (mode) {
			case "Numeric":
				newData = qrNumber(data);
				break;
			case "Alphanumeric":
				newData = qrAlphaNum(data);
				break;
			case "Byte":
				newData = qr8BitByte(data);
				break;
			case "Kanji":
				newData = qrKanji(data);
				break;
			default: throw "mode:" + mode;
		}
		_dataList.push(newData);
		_dataCache = null;
	};
	_this.isDark = function(row, col) {
		if (row < 0 || _moduleCount <= row || col < 0 || _moduleCount <= col) throw row + "," + col;
		return _modules[row][col];
	};
	_this.getModuleCount = function() {
		return _moduleCount;
	};
	_this.make = function() {
		if (_typeNumber < 1) {
			let typeNumber = 1;
			for (; typeNumber < 40; typeNumber++) {
				const rsBlocks = QRRSBlock.getRSBlocks(typeNumber, _errorCorrectionLevel);
				const buffer = qrBitBuffer();
				for (let i = 0; i < _dataList.length; i++) {
					const data = _dataList[i];
					buffer.put(data.getMode(), 4);
					buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber));
					data.write(buffer);
				}
				let totalDataCount = 0;
				for (let i = 0; i < rsBlocks.length; i++) totalDataCount += rsBlocks[i].dataCount;
				if (buffer.getLengthInBits() <= totalDataCount * 8) break;
			}
			_typeNumber = typeNumber;
		}
		makeImpl(false, getBestMaskPattern());
	};
	_this.createTableTag = function(cellSize, margin) {
		cellSize = cellSize || 2;
		margin = typeof margin == "undefined" ? cellSize * 4 : margin;
		let qrHtml = "";
		qrHtml += "<table style=\"";
		qrHtml += " border-width: 0px; border-style: none;";
		qrHtml += " border-collapse: collapse;";
		qrHtml += " padding: 0px; margin: " + margin + "px;";
		qrHtml += "\">";
		qrHtml += "<tbody>";
		for (let r = 0; r < _this.getModuleCount(); r += 1) {
			qrHtml += "<tr>";
			for (let c = 0; c < _this.getModuleCount(); c += 1) {
				qrHtml += "<td style=\"";
				qrHtml += " border-width: 0px; border-style: none;";
				qrHtml += " border-collapse: collapse;";
				qrHtml += " padding: 0px; margin: 0px;";
				qrHtml += " width: " + cellSize + "px;";
				qrHtml += " height: " + cellSize + "px;";
				qrHtml += " background-color: ";
				qrHtml += _this.isDark(r, c) ? "#000000" : "#ffffff";
				qrHtml += ";";
				qrHtml += "\"/>";
			}
			qrHtml += "</tr>";
		}
		qrHtml += "</tbody>";
		qrHtml += "</table>";
		return qrHtml;
	};
	_this.createSvgTag = function(cellSize, margin, alt, title) {
		let opts = {};
		if (typeof arguments[0] == "object") {
			opts = arguments[0];
			cellSize = opts.cellSize;
			margin = opts.margin;
			alt = opts.alt;
			title = opts.title;
		}
		cellSize = cellSize || 2;
		margin = typeof margin == "undefined" ? cellSize * 4 : margin;
		alt = typeof alt === "string" ? { text: alt } : alt || {};
		alt.text = alt.text || null;
		alt.id = alt.text ? alt.id || "qrcode-description" : null;
		title = typeof title === "string" ? { text: title } : title || {};
		title.text = title.text || null;
		title.id = title.text ? title.id || "qrcode-title" : null;
		const size = _this.getModuleCount() * cellSize + margin * 2;
		let c, mc, r, mr, qrSvg = "", rect;
		rect = "l" + cellSize + ",0 0," + cellSize + " -" + cellSize + ",0 0,-" + cellSize + "z ";
		qrSvg += "<svg version=\"1.1\" xmlns=\"http://www.w3.org/2000/svg\"";
		qrSvg += !opts.scalable ? " width=\"" + size + "px\" height=\"" + size + "px\"" : "";
		qrSvg += " viewBox=\"0 0 " + size + " " + size + "\" ";
		qrSvg += " preserveAspectRatio=\"xMinYMin meet\"";
		qrSvg += title.text || alt.text ? " role=\"img\" aria-labelledby=\"" + escapeXml([title.id, alt.id].join(" ").trim()) + "\"" : "";
		qrSvg += ">";
		qrSvg += title.text ? "<title id=\"" + escapeXml(title.id) + "\">" + escapeXml(title.text) + "</title>" : "";
		qrSvg += alt.text ? "<description id=\"" + escapeXml(alt.id) + "\">" + escapeXml(alt.text) + "</description>" : "";
		qrSvg += "<rect width=\"100%\" height=\"100%\" fill=\"white\" cx=\"0\" cy=\"0\"/>";
		qrSvg += "<path d=\"";
		for (r = 0; r < _this.getModuleCount(); r += 1) {
			mr = r * cellSize + margin;
			for (c = 0; c < _this.getModuleCount(); c += 1) if (_this.isDark(r, c)) {
				mc = c * cellSize + margin;
				qrSvg += "M" + mc + "," + mr + rect;
			}
		}
		qrSvg += "\" stroke=\"transparent\" fill=\"black\"/>";
		qrSvg += "</svg>";
		return qrSvg;
	};
	_this.createDataURL = function(cellSize, margin) {
		cellSize = cellSize || 2;
		margin = typeof margin == "undefined" ? cellSize * 4 : margin;
		const size = _this.getModuleCount() * cellSize + margin * 2;
		const min = margin;
		const max = size - margin;
		return createDataURL(size, size, function(x, y) {
			if (min <= x && x < max && min <= y && y < max) {
				const c = Math.floor((x - min) / cellSize);
				const r = Math.floor((y - min) / cellSize);
				return _this.isDark(r, c) ? 0 : 1;
			} else return 1;
		});
	};
	_this.createImgTag = function(cellSize, margin, alt) {
		cellSize = cellSize || 2;
		margin = typeof margin == "undefined" ? cellSize * 4 : margin;
		const size = _this.getModuleCount() * cellSize + margin * 2;
		let img = "";
		img += "<img";
		img += " src=\"";
		img += _this.createDataURL(cellSize, margin);
		img += "\"";
		img += " width=\"";
		img += size;
		img += "\"";
		img += " height=\"";
		img += size;
		img += "\"";
		if (alt) {
			img += " alt=\"";
			img += escapeXml(alt);
			img += "\"";
		}
		img += "/>";
		return img;
	};
	const escapeXml = function(s) {
		let escaped = "";
		for (let i = 0; i < s.length; i += 1) {
			const c = s.charAt(i);
			switch (c) {
				case "<":
					escaped += "&lt;";
					break;
				case ">":
					escaped += "&gt;";
					break;
				case "&":
					escaped += "&amp;";
					break;
				case "\"":
					escaped += "&quot;";
					break;
				default: escaped += c;
			}
		}
		return escaped;
	};
	const _createHalfASCII = function(margin) {
		const cellSize = 1;
		margin = typeof margin == "undefined" ? 2 : margin;
		const size = _this.getModuleCount() * cellSize + margin * 2;
		const min = margin;
		const max = size - margin;
		let y, x, r1, r2, p;
		const blocks = {
			"██": "█",
			"█ ": "▀",
			" █": "▄",
			"  ": " "
		};
		const blocksLastLineNoMargin = {
			"██": "▀",
			"█ ": "▀",
			" █": " ",
			"  ": " "
		};
		let ascii = "";
		for (y = 0; y < size; y += 2) {
			r1 = Math.floor((y - min) / cellSize);
			r2 = Math.floor((y + 1 - min) / cellSize);
			for (x = 0; x < size; x += 1) {
				p = "█";
				if (min <= x && x < max && min <= y && y < max && _this.isDark(r1, Math.floor((x - min) / cellSize))) p = " ";
				if (min <= x && x < max && min <= y + 1 && y + 1 < max && _this.isDark(r2, Math.floor((x - min) / cellSize))) p += " ";
				else p += "█";
				ascii += margin < 1 && y + 1 >= max ? blocksLastLineNoMargin[p] : blocks[p];
			}
			ascii += "\n";
		}
		if (size % 2 && margin > 0) return ascii.substring(0, ascii.length - size - 1) + Array(size + 1).join("▀");
		return ascii.substring(0, ascii.length - 1);
	};
	_this.createASCII = function(cellSize, margin) {
		cellSize = cellSize || 1;
		if (cellSize < 2) return _createHalfASCII(margin);
		cellSize -= 1;
		margin = typeof margin == "undefined" ? cellSize * 2 : margin;
		const size = _this.getModuleCount() * cellSize + margin * 2;
		const min = margin;
		const max = size - margin;
		let y, x, r, p;
		const white = Array(cellSize + 1).join("██");
		const black = Array(cellSize + 1).join("  ");
		let ascii = "";
		let line = "";
		for (y = 0; y < size; y += 1) {
			r = Math.floor((y - min) / cellSize);
			line = "";
			for (x = 0; x < size; x += 1) {
				p = 1;
				if (min <= x && x < max && min <= y && y < max && _this.isDark(r, Math.floor((x - min) / cellSize))) p = 0;
				line += p ? white : black;
			}
			for (r = 0; r < cellSize; r += 1) ascii += line + "\n";
		}
		return ascii.substring(0, ascii.length - 1);
	};
	_this.renderTo2dContext = function(context, cellSize) {
		cellSize = cellSize || 2;
		const length = _this.getModuleCount();
		for (let row = 0; row < length; row++) for (let col = 0; col < length; col++) {
			context.fillStyle = _this.isDark(row, col) ? "black" : "white";
			context.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
		}
	};
	return _this;
};
qrcode.stringToBytes = function(s) {
	const bytes = [];
	for (let i = 0; i < s.length; i += 1) {
		const c = s.charCodeAt(i);
		bytes.push(c & 255);
	}
	return bytes;
};
/**
* @param unicodeData base64 string of byte array.
* [16bit Unicode],[16bit Bytes], ...
* @param numChars
*/
qrcode.createStringToBytes = function(unicodeData, numChars) {
	const unicodeMap = function() {
		const bin = base64DecodeInputStream(unicodeData);
		const read = function() {
			const b = bin.read();
			if (b == -1) throw "eof";
			return b;
		};
		let count = 0;
		const unicodeMap = {};
		while (true) {
			const b0 = bin.read();
			if (b0 == -1) break;
			const b1 = read();
			const b2 = read();
			const b3 = read();
			const k = String.fromCharCode(b0 << 8 | b1);
			unicodeMap[k] = b2 << 8 | b3;
			count += 1;
		}
		if (count != numChars) throw count + " != " + numChars;
		return unicodeMap;
	}();
	const unknownChar = "?".charCodeAt(0);
	return function(s) {
		const bytes = [];
		for (let i = 0; i < s.length; i += 1) {
			const c = s.charCodeAt(i);
			if (c < 128) bytes.push(c);
			else {
				const b = unicodeMap[s.charAt(i)];
				if (typeof b == "number") {
					if ((b & 255) == b) bytes.push(b);
					else {
						bytes.push(b >>> 8);
						bytes.push(b & 255);
					}
				} else bytes.push(unknownChar);
			}
		}
		return bytes;
	};
};
const QRMode = {
	MODE_NUMBER: 1,
	MODE_ALPHA_NUM: 2,
	MODE_8BIT_BYTE: 4,
	MODE_KANJI: 8
};
const QRErrorCorrectionLevel = {
	L: 1,
	M: 0,
	Q: 3,
	H: 2
};
const QRMaskPattern = {
	PATTERN000: 0,
	PATTERN001: 1,
	PATTERN010: 2,
	PATTERN011: 3,
	PATTERN100: 4,
	PATTERN101: 5,
	PATTERN110: 6,
	PATTERN111: 7
};
const QRUtil = function() {
	const PATTERN_POSITION_TABLE = [
		[],
		[6, 18],
		[6, 22],
		[6, 26],
		[6, 30],
		[6, 34],
		[
			6,
			22,
			38
		],
		[
			6,
			24,
			42
		],
		[
			6,
			26,
			46
		],
		[
			6,
			28,
			50
		],
		[
			6,
			30,
			54
		],
		[
			6,
			32,
			58
		],
		[
			6,
			34,
			62
		],
		[
			6,
			26,
			46,
			66
		],
		[
			6,
			26,
			48,
			70
		],
		[
			6,
			26,
			50,
			74
		],
		[
			6,
			30,
			54,
			78
		],
		[
			6,
			30,
			56,
			82
		],
		[
			6,
			30,
			58,
			86
		],
		[
			6,
			34,
			62,
			90
		],
		[
			6,
			28,
			50,
			72,
			94
		],
		[
			6,
			26,
			50,
			74,
			98
		],
		[
			6,
			30,
			54,
			78,
			102
		],
		[
			6,
			28,
			54,
			80,
			106
		],
		[
			6,
			32,
			58,
			84,
			110
		],
		[
			6,
			30,
			58,
			86,
			114
		],
		[
			6,
			34,
			62,
			90,
			118
		],
		[
			6,
			26,
			50,
			74,
			98,
			122
		],
		[
			6,
			30,
			54,
			78,
			102,
			126
		],
		[
			6,
			26,
			52,
			78,
			104,
			130
		],
		[
			6,
			30,
			56,
			82,
			108,
			134
		],
		[
			6,
			34,
			60,
			86,
			112,
			138
		],
		[
			6,
			30,
			58,
			86,
			114,
			142
		],
		[
			6,
			34,
			62,
			90,
			118,
			146
		],
		[
			6,
			30,
			54,
			78,
			102,
			126,
			150
		],
		[
			6,
			24,
			50,
			76,
			102,
			128,
			154
		],
		[
			6,
			28,
			54,
			80,
			106,
			132,
			158
		],
		[
			6,
			32,
			58,
			84,
			110,
			136,
			162
		],
		[
			6,
			26,
			54,
			82,
			110,
			138,
			166
		],
		[
			6,
			30,
			58,
			86,
			114,
			142,
			170
		]
	];
	const G15 = 1335;
	const G18 = 7973;
	const G15_MASK = 21522;
	const _this = {};
	const getBCHDigit = function(data) {
		let digit = 0;
		while (data != 0) {
			digit += 1;
			data >>>= 1;
		}
		return digit;
	};
	_this.getBCHTypeInfo = function(data) {
		let d = data << 10;
		while (getBCHDigit(d) - getBCHDigit(G15) >= 0) d ^= G15 << getBCHDigit(d) - getBCHDigit(G15);
		return (data << 10 | d) ^ G15_MASK;
	};
	_this.getBCHTypeNumber = function(data) {
		let d = data << 12;
		while (getBCHDigit(d) - getBCHDigit(G18) >= 0) d ^= G18 << getBCHDigit(d) - getBCHDigit(G18);
		return data << 12 | d;
	};
	_this.getPatternPosition = function(typeNumber) {
		return PATTERN_POSITION_TABLE[typeNumber - 1];
	};
	_this.getMaskFunction = function(maskPattern) {
		switch (maskPattern) {
			case QRMaskPattern.PATTERN000: return function(i, j) {
				return (i + j) % 2 == 0;
			};
			case QRMaskPattern.PATTERN001: return function(i, j) {
				return i % 2 == 0;
			};
			case QRMaskPattern.PATTERN010: return function(i, j) {
				return j % 3 == 0;
			};
			case QRMaskPattern.PATTERN011: return function(i, j) {
				return (i + j) % 3 == 0;
			};
			case QRMaskPattern.PATTERN100: return function(i, j) {
				return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 == 0;
			};
			case QRMaskPattern.PATTERN101: return function(i, j) {
				return i * j % 2 + i * j % 3 == 0;
			};
			case QRMaskPattern.PATTERN110: return function(i, j) {
				return (i * j % 2 + i * j % 3) % 2 == 0;
			};
			case QRMaskPattern.PATTERN111: return function(i, j) {
				return (i * j % 3 + (i + j) % 2) % 2 == 0;
			};
			default: throw "bad maskPattern:" + maskPattern;
		}
	};
	_this.getErrorCorrectPolynomial = function(errorCorrectLength) {
		let a = qrPolynomial([1], 0);
		for (let i = 0; i < errorCorrectLength; i += 1) a = a.multiply(qrPolynomial([1, QRMath.gexp(i)], 0));
		return a;
	};
	_this.getLengthInBits = function(mode, type) {
		if (1 <= type && type < 10) switch (mode) {
			case QRMode.MODE_NUMBER: return 10;
			case QRMode.MODE_ALPHA_NUM: return 9;
			case QRMode.MODE_8BIT_BYTE: return 8;
			case QRMode.MODE_KANJI: return 8;
			default: throw "mode:" + mode;
		}
		else if (type < 27) switch (mode) {
			case QRMode.MODE_NUMBER: return 12;
			case QRMode.MODE_ALPHA_NUM: return 11;
			case QRMode.MODE_8BIT_BYTE: return 16;
			case QRMode.MODE_KANJI: return 10;
			default: throw "mode:" + mode;
		}
		else if (type < 41) switch (mode) {
			case QRMode.MODE_NUMBER: return 14;
			case QRMode.MODE_ALPHA_NUM: return 13;
			case QRMode.MODE_8BIT_BYTE: return 16;
			case QRMode.MODE_KANJI: return 12;
			default: throw "mode:" + mode;
		}
		else throw "type:" + type;
	};
	_this.getLostPoint = function(qrcode) {
		const moduleCount = qrcode.getModuleCount();
		let lostPoint = 0;
		for (let row = 0; row < moduleCount; row += 1) for (let col = 0; col < moduleCount; col += 1) {
			let sameCount = 0;
			const dark = qrcode.isDark(row, col);
			for (let r = -1; r <= 1; r += 1) {
				if (row + r < 0 || moduleCount <= row + r) continue;
				for (let c = -1; c <= 1; c += 1) {
					if (col + c < 0 || moduleCount <= col + c) continue;
					if (r == 0 && c == 0) continue;
					if (dark == qrcode.isDark(row + r, col + c)) sameCount += 1;
				}
			}
			if (sameCount > 5) lostPoint += 3 + sameCount - 5;
		}
		for (let row = 0; row < moduleCount - 1; row += 1) for (let col = 0; col < moduleCount - 1; col += 1) {
			let count = 0;
			if (qrcode.isDark(row, col)) count += 1;
			if (qrcode.isDark(row + 1, col)) count += 1;
			if (qrcode.isDark(row, col + 1)) count += 1;
			if (qrcode.isDark(row + 1, col + 1)) count += 1;
			if (count == 0 || count == 4) lostPoint += 3;
		}
		for (let row = 0; row < moduleCount; row += 1) for (let col = 0; col < moduleCount - 6; col += 1) if (qrcode.isDark(row, col) && !qrcode.isDark(row, col + 1) && qrcode.isDark(row, col + 2) && qrcode.isDark(row, col + 3) && qrcode.isDark(row, col + 4) && !qrcode.isDark(row, col + 5) && qrcode.isDark(row, col + 6)) lostPoint += 40;
		for (let col = 0; col < moduleCount; col += 1) for (let row = 0; row < moduleCount - 6; row += 1) if (qrcode.isDark(row, col) && !qrcode.isDark(row + 1, col) && qrcode.isDark(row + 2, col) && qrcode.isDark(row + 3, col) && qrcode.isDark(row + 4, col) && !qrcode.isDark(row + 5, col) && qrcode.isDark(row + 6, col)) lostPoint += 40;
		let darkCount = 0;
		for (let col = 0; col < moduleCount; col += 1) for (let row = 0; row < moduleCount; row += 1) if (qrcode.isDark(row, col)) darkCount += 1;
		const ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
		lostPoint += ratio * 10;
		return lostPoint;
	};
	return _this;
}();
const QRMath = function() {
	const EXP_TABLE = new Array(256);
	const LOG_TABLE = new Array(256);
	for (let i = 0; i < 8; i += 1) EXP_TABLE[i] = 1 << i;
	for (let i = 8; i < 256; i += 1) EXP_TABLE[i] = EXP_TABLE[i - 4] ^ EXP_TABLE[i - 5] ^ EXP_TABLE[i - 6] ^ EXP_TABLE[i - 8];
	for (let i = 0; i < 255; i += 1) LOG_TABLE[EXP_TABLE[i]] = i;
	const _this = {};
	_this.glog = function(n) {
		if (n < 1) throw "glog(" + n + ")";
		return LOG_TABLE[n];
	};
	_this.gexp = function(n) {
		while (n < 0) n += 255;
		while (n >= 256) n -= 255;
		return EXP_TABLE[n];
	};
	return _this;
}();
const qrPolynomial = function(num, shift) {
	if (typeof num.length == "undefined") throw num.length + "/" + shift;
	const _num = function() {
		let offset = 0;
		while (offset < num.length && num[offset] == 0) offset += 1;
		const _num = new Array(num.length - offset + shift);
		for (let i = 0; i < num.length - offset; i += 1) _num[i] = num[i + offset];
		return _num;
	}();
	const _this = {};
	_this.getAt = function(index) {
		return _num[index];
	};
	_this.getLength = function() {
		return _num.length;
	};
	_this.multiply = function(e) {
		const num = new Array(_this.getLength() + e.getLength() - 1);
		for (let i = 0; i < _this.getLength(); i += 1) for (let j = 0; j < e.getLength(); j += 1) num[i + j] ^= QRMath.gexp(QRMath.glog(_this.getAt(i)) + QRMath.glog(e.getAt(j)));
		return qrPolynomial(num, 0);
	};
	_this.mod = function(e) {
		if (_this.getLength() - e.getLength() < 0) return _this;
		const ratio = QRMath.glog(_this.getAt(0)) - QRMath.glog(e.getAt(0));
		const num = new Array(_this.getLength());
		for (let i = 0; i < _this.getLength(); i += 1) num[i] = _this.getAt(i);
		for (let i = 0; i < e.getLength(); i += 1) num[i] ^= QRMath.gexp(QRMath.glog(e.getAt(i)) + ratio);
		return qrPolynomial(num, 0).mod(e);
	};
	return _this;
};
const QRRSBlock = function() {
	const RS_BLOCK_TABLE = [
		[
			1,
			26,
			19
		],
		[
			1,
			26,
			16
		],
		[
			1,
			26,
			13
		],
		[
			1,
			26,
			9
		],
		[
			1,
			44,
			34
		],
		[
			1,
			44,
			28
		],
		[
			1,
			44,
			22
		],
		[
			1,
			44,
			16
		],
		[
			1,
			70,
			55
		],
		[
			1,
			70,
			44
		],
		[
			2,
			35,
			17
		],
		[
			2,
			35,
			13
		],
		[
			1,
			100,
			80
		],
		[
			2,
			50,
			32
		],
		[
			2,
			50,
			24
		],
		[
			4,
			25,
			9
		],
		[
			1,
			134,
			108
		],
		[
			2,
			67,
			43
		],
		[
			2,
			33,
			15,
			2,
			34,
			16
		],
		[
			2,
			33,
			11,
			2,
			34,
			12
		],
		[
			2,
			86,
			68
		],
		[
			4,
			43,
			27
		],
		[
			4,
			43,
			19
		],
		[
			4,
			43,
			15
		],
		[
			2,
			98,
			78
		],
		[
			4,
			49,
			31
		],
		[
			2,
			32,
			14,
			4,
			33,
			15
		],
		[
			4,
			39,
			13,
			1,
			40,
			14
		],
		[
			2,
			121,
			97
		],
		[
			2,
			60,
			38,
			2,
			61,
			39
		],
		[
			4,
			40,
			18,
			2,
			41,
			19
		],
		[
			4,
			40,
			14,
			2,
			41,
			15
		],
		[
			2,
			146,
			116
		],
		[
			3,
			58,
			36,
			2,
			59,
			37
		],
		[
			4,
			36,
			16,
			4,
			37,
			17
		],
		[
			4,
			36,
			12,
			4,
			37,
			13
		],
		[
			2,
			86,
			68,
			2,
			87,
			69
		],
		[
			4,
			69,
			43,
			1,
			70,
			44
		],
		[
			6,
			43,
			19,
			2,
			44,
			20
		],
		[
			6,
			43,
			15,
			2,
			44,
			16
		],
		[
			4,
			101,
			81
		],
		[
			1,
			80,
			50,
			4,
			81,
			51
		],
		[
			4,
			50,
			22,
			4,
			51,
			23
		],
		[
			3,
			36,
			12,
			8,
			37,
			13
		],
		[
			2,
			116,
			92,
			2,
			117,
			93
		],
		[
			6,
			58,
			36,
			2,
			59,
			37
		],
		[
			4,
			46,
			20,
			6,
			47,
			21
		],
		[
			7,
			42,
			14,
			4,
			43,
			15
		],
		[
			4,
			133,
			107
		],
		[
			8,
			59,
			37,
			1,
			60,
			38
		],
		[
			8,
			44,
			20,
			4,
			45,
			21
		],
		[
			12,
			33,
			11,
			4,
			34,
			12
		],
		[
			3,
			145,
			115,
			1,
			146,
			116
		],
		[
			4,
			64,
			40,
			5,
			65,
			41
		],
		[
			11,
			36,
			16,
			5,
			37,
			17
		],
		[
			11,
			36,
			12,
			5,
			37,
			13
		],
		[
			5,
			109,
			87,
			1,
			110,
			88
		],
		[
			5,
			65,
			41,
			5,
			66,
			42
		],
		[
			5,
			54,
			24,
			7,
			55,
			25
		],
		[
			11,
			36,
			12,
			7,
			37,
			13
		],
		[
			5,
			122,
			98,
			1,
			123,
			99
		],
		[
			7,
			73,
			45,
			3,
			74,
			46
		],
		[
			15,
			43,
			19,
			2,
			44,
			20
		],
		[
			3,
			45,
			15,
			13,
			46,
			16
		],
		[
			1,
			135,
			107,
			5,
			136,
			108
		],
		[
			10,
			74,
			46,
			1,
			75,
			47
		],
		[
			1,
			50,
			22,
			15,
			51,
			23
		],
		[
			2,
			42,
			14,
			17,
			43,
			15
		],
		[
			5,
			150,
			120,
			1,
			151,
			121
		],
		[
			9,
			69,
			43,
			4,
			70,
			44
		],
		[
			17,
			50,
			22,
			1,
			51,
			23
		],
		[
			2,
			42,
			14,
			19,
			43,
			15
		],
		[
			3,
			141,
			113,
			4,
			142,
			114
		],
		[
			3,
			70,
			44,
			11,
			71,
			45
		],
		[
			17,
			47,
			21,
			4,
			48,
			22
		],
		[
			9,
			39,
			13,
			16,
			40,
			14
		],
		[
			3,
			135,
			107,
			5,
			136,
			108
		],
		[
			3,
			67,
			41,
			13,
			68,
			42
		],
		[
			15,
			54,
			24,
			5,
			55,
			25
		],
		[
			15,
			43,
			15,
			10,
			44,
			16
		],
		[
			4,
			144,
			116,
			4,
			145,
			117
		],
		[
			17,
			68,
			42
		],
		[
			17,
			50,
			22,
			6,
			51,
			23
		],
		[
			19,
			46,
			16,
			6,
			47,
			17
		],
		[
			2,
			139,
			111,
			7,
			140,
			112
		],
		[
			17,
			74,
			46
		],
		[
			7,
			54,
			24,
			16,
			55,
			25
		],
		[
			34,
			37,
			13
		],
		[
			4,
			151,
			121,
			5,
			152,
			122
		],
		[
			4,
			75,
			47,
			14,
			76,
			48
		],
		[
			11,
			54,
			24,
			14,
			55,
			25
		],
		[
			16,
			45,
			15,
			14,
			46,
			16
		],
		[
			6,
			147,
			117,
			4,
			148,
			118
		],
		[
			6,
			73,
			45,
			14,
			74,
			46
		],
		[
			11,
			54,
			24,
			16,
			55,
			25
		],
		[
			30,
			46,
			16,
			2,
			47,
			17
		],
		[
			8,
			132,
			106,
			4,
			133,
			107
		],
		[
			8,
			75,
			47,
			13,
			76,
			48
		],
		[
			7,
			54,
			24,
			22,
			55,
			25
		],
		[
			22,
			45,
			15,
			13,
			46,
			16
		],
		[
			10,
			142,
			114,
			2,
			143,
			115
		],
		[
			19,
			74,
			46,
			4,
			75,
			47
		],
		[
			28,
			50,
			22,
			6,
			51,
			23
		],
		[
			33,
			46,
			16,
			4,
			47,
			17
		],
		[
			8,
			152,
			122,
			4,
			153,
			123
		],
		[
			22,
			73,
			45,
			3,
			74,
			46
		],
		[
			8,
			53,
			23,
			26,
			54,
			24
		],
		[
			12,
			45,
			15,
			28,
			46,
			16
		],
		[
			3,
			147,
			117,
			10,
			148,
			118
		],
		[
			3,
			73,
			45,
			23,
			74,
			46
		],
		[
			4,
			54,
			24,
			31,
			55,
			25
		],
		[
			11,
			45,
			15,
			31,
			46,
			16
		],
		[
			7,
			146,
			116,
			7,
			147,
			117
		],
		[
			21,
			73,
			45,
			7,
			74,
			46
		],
		[
			1,
			53,
			23,
			37,
			54,
			24
		],
		[
			19,
			45,
			15,
			26,
			46,
			16
		],
		[
			5,
			145,
			115,
			10,
			146,
			116
		],
		[
			19,
			75,
			47,
			10,
			76,
			48
		],
		[
			15,
			54,
			24,
			25,
			55,
			25
		],
		[
			23,
			45,
			15,
			25,
			46,
			16
		],
		[
			13,
			145,
			115,
			3,
			146,
			116
		],
		[
			2,
			74,
			46,
			29,
			75,
			47
		],
		[
			42,
			54,
			24,
			1,
			55,
			25
		],
		[
			23,
			45,
			15,
			28,
			46,
			16
		],
		[
			17,
			145,
			115
		],
		[
			10,
			74,
			46,
			23,
			75,
			47
		],
		[
			10,
			54,
			24,
			35,
			55,
			25
		],
		[
			19,
			45,
			15,
			35,
			46,
			16
		],
		[
			17,
			145,
			115,
			1,
			146,
			116
		],
		[
			14,
			74,
			46,
			21,
			75,
			47
		],
		[
			29,
			54,
			24,
			19,
			55,
			25
		],
		[
			11,
			45,
			15,
			46,
			46,
			16
		],
		[
			13,
			145,
			115,
			6,
			146,
			116
		],
		[
			14,
			74,
			46,
			23,
			75,
			47
		],
		[
			44,
			54,
			24,
			7,
			55,
			25
		],
		[
			59,
			46,
			16,
			1,
			47,
			17
		],
		[
			12,
			151,
			121,
			7,
			152,
			122
		],
		[
			12,
			75,
			47,
			26,
			76,
			48
		],
		[
			39,
			54,
			24,
			14,
			55,
			25
		],
		[
			22,
			45,
			15,
			41,
			46,
			16
		],
		[
			6,
			151,
			121,
			14,
			152,
			122
		],
		[
			6,
			75,
			47,
			34,
			76,
			48
		],
		[
			46,
			54,
			24,
			10,
			55,
			25
		],
		[
			2,
			45,
			15,
			64,
			46,
			16
		],
		[
			17,
			152,
			122,
			4,
			153,
			123
		],
		[
			29,
			74,
			46,
			14,
			75,
			47
		],
		[
			49,
			54,
			24,
			10,
			55,
			25
		],
		[
			24,
			45,
			15,
			46,
			46,
			16
		],
		[
			4,
			152,
			122,
			18,
			153,
			123
		],
		[
			13,
			74,
			46,
			32,
			75,
			47
		],
		[
			48,
			54,
			24,
			14,
			55,
			25
		],
		[
			42,
			45,
			15,
			32,
			46,
			16
		],
		[
			20,
			147,
			117,
			4,
			148,
			118
		],
		[
			40,
			75,
			47,
			7,
			76,
			48
		],
		[
			43,
			54,
			24,
			22,
			55,
			25
		],
		[
			10,
			45,
			15,
			67,
			46,
			16
		],
		[
			19,
			148,
			118,
			6,
			149,
			119
		],
		[
			18,
			75,
			47,
			31,
			76,
			48
		],
		[
			34,
			54,
			24,
			34,
			55,
			25
		],
		[
			20,
			45,
			15,
			61,
			46,
			16
		]
	];
	const qrRSBlock = function(totalCount, dataCount) {
		const _this = {};
		_this.totalCount = totalCount;
		_this.dataCount = dataCount;
		return _this;
	};
	const _this = {};
	const getRsBlockTable = function(typeNumber, errorCorrectionLevel) {
		switch (errorCorrectionLevel) {
			case QRErrorCorrectionLevel.L: return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
			case QRErrorCorrectionLevel.M: return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
			case QRErrorCorrectionLevel.Q: return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
			case QRErrorCorrectionLevel.H: return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
			default: return;
		}
	};
	_this.getRSBlocks = function(typeNumber, errorCorrectionLevel) {
		const rsBlock = getRsBlockTable(typeNumber, errorCorrectionLevel);
		if (typeof rsBlock == "undefined") throw "bad rs block @ typeNumber:" + typeNumber + "/errorCorrectionLevel:" + errorCorrectionLevel;
		const length = rsBlock.length / 3;
		const list = [];
		for (let i = 0; i < length; i += 1) {
			const count = rsBlock[i * 3 + 0];
			const totalCount = rsBlock[i * 3 + 1];
			const dataCount = rsBlock[i * 3 + 2];
			for (let j = 0; j < count; j += 1) list.push(qrRSBlock(totalCount, dataCount));
		}
		return list;
	};
	return _this;
}();
const qrBitBuffer = function() {
	const _buffer = [];
	let _length = 0;
	const _this = {};
	_this.getBuffer = function() {
		return _buffer;
	};
	_this.getAt = function(index) {
		const bufIndex = Math.floor(index / 8);
		return (_buffer[bufIndex] >>> 7 - index % 8 & 1) == 1;
	};
	_this.put = function(num, length) {
		for (let i = 0; i < length; i += 1) _this.putBit((num >>> length - i - 1 & 1) == 1);
	};
	_this.getLengthInBits = function() {
		return _length;
	};
	_this.putBit = function(bit) {
		const bufIndex = Math.floor(_length / 8);
		if (_buffer.length <= bufIndex) _buffer.push(0);
		if (bit) _buffer[bufIndex] |= 128 >>> _length % 8;
		_length += 1;
	};
	return _this;
};
const qrNumber = function(data) {
	const _mode = QRMode.MODE_NUMBER;
	const _data = data;
	const _this = {};
	_this.getMode = function() {
		return _mode;
	};
	_this.getLength = function(buffer) {
		return _data.length;
	};
	_this.write = function(buffer) {
		const data = _data;
		let i = 0;
		while (i + 2 < data.length) {
			buffer.put(strToNum(data.substring(i, i + 3)), 10);
			i += 3;
		}
		if (i < data.length) {
			if (data.length - i == 1) buffer.put(strToNum(data.substring(i, i + 1)), 4);
			else if (data.length - i == 2) buffer.put(strToNum(data.substring(i, i + 2)), 7);
		}
	};
	const strToNum = function(s) {
		let num = 0;
		for (let i = 0; i < s.length; i += 1) num = num * 10 + chatToNum(s.charAt(i));
		return num;
	};
	const chatToNum = function(c) {
		if ("0" <= c && c <= "9") return c.charCodeAt(0) - "0".charCodeAt(0);
		throw "illegal char :" + c;
	};
	return _this;
};
const qrAlphaNum = function(data) {
	const _mode = QRMode.MODE_ALPHA_NUM;
	const _data = data;
	const _this = {};
	_this.getMode = function() {
		return _mode;
	};
	_this.getLength = function(buffer) {
		return _data.length;
	};
	_this.write = function(buffer) {
		const s = _data;
		let i = 0;
		while (i + 1 < s.length) {
			buffer.put(getCode(s.charAt(i)) * 45 + getCode(s.charAt(i + 1)), 11);
			i += 2;
		}
		if (i < s.length) buffer.put(getCode(s.charAt(i)), 6);
	};
	const getCode = function(c) {
		if ("0" <= c && c <= "9") return c.charCodeAt(0) - "0".charCodeAt(0);
		else if ("A" <= c && c <= "Z") return c.charCodeAt(0) - "A".charCodeAt(0) + 10;
		else switch (c) {
			case " ": return 36;
			case "$": return 37;
			case "%": return 38;
			case "*": return 39;
			case "+": return 40;
			case "-": return 41;
			case ".": return 42;
			case "/": return 43;
			case ":": return 44;
			default: throw "illegal char :" + c;
		}
	};
	return _this;
};
const qr8BitByte = function(data) {
	const _mode = QRMode.MODE_8BIT_BYTE;
	const _bytes = qrcode.stringToBytes(data);
	const _this = {};
	_this.getMode = function() {
		return _mode;
	};
	_this.getLength = function(buffer) {
		return _bytes.length;
	};
	_this.write = function(buffer) {
		for (let i = 0; i < _bytes.length; i += 1) buffer.put(_bytes[i], 8);
	};
	return _this;
};
const qrKanji = function(data) {
	const _mode = QRMode.MODE_KANJI;
	const stringToBytes = qrcode.stringToBytes;
	(function(c, code) {
		const test = stringToBytes(c);
		if (test.length != 2 || (test[0] << 8 | test[1]) != code) throw "sjis not supported.";
	})("友", 38726);
	const _bytes = stringToBytes(data);
	const _this = {};
	_this.getMode = function() {
		return _mode;
	};
	_this.getLength = function(buffer) {
		return ~~(_bytes.length / 2);
	};
	_this.write = function(buffer) {
		const data = _bytes;
		let i = 0;
		while (i + 1 < data.length) {
			let c = (255 & data[i]) << 8 | 255 & data[i + 1];
			if (33088 <= c && c <= 40956) c -= 33088;
			else if (57408 <= c && c <= 60351) c -= 49472;
			else throw "illegal char at " + (i + 1) + "/" + c;
			c = (c >>> 8 & 255) * 192 + (c & 255);
			buffer.put(c, 13);
			i += 2;
		}
		if (i < data.length) throw "illegal char at " + (i + 1);
	};
	return _this;
};
const byteArrayOutputStream = function() {
	const _bytes = [];
	const _this = {};
	_this.writeByte = function(b) {
		_bytes.push(b & 255);
	};
	_this.writeShort = function(i) {
		_this.writeByte(i);
		_this.writeByte(i >>> 8);
	};
	_this.writeBytes = function(b, off, len) {
		off = off || 0;
		len = len || b.length;
		for (let i = 0; i < len; i += 1) _this.writeByte(b[i + off]);
	};
	_this.writeString = function(s) {
		for (let i = 0; i < s.length; i += 1) _this.writeByte(s.charCodeAt(i));
	};
	_this.toByteArray = function() {
		return _bytes;
	};
	_this.toString = function() {
		let s = "";
		s += "[";
		for (let i = 0; i < _bytes.length; i += 1) {
			if (i > 0) s += ",";
			s += _bytes[i];
		}
		s += "]";
		return s;
	};
	return _this;
};
const base64EncodeOutputStream = function() {
	let _buffer = 0;
	let _buflen = 0;
	let _length = 0;
	let _base64 = "";
	const _this = {};
	const writeEncoded = function(b) {
		_base64 += String.fromCharCode(encode(b & 63));
	};
	const encode = function(n) {
		if (n < 0) throw "n:" + n;
		else if (n < 26) return 65 + n;
		else if (n < 52) return 97 + (n - 26);
		else if (n < 62) return 48 + (n - 52);
		else if (n == 62) return 43;
		else if (n == 63) return 47;
		else throw "n:" + n;
	};
	_this.writeByte = function(n) {
		_buffer = _buffer << 8 | n & 255;
		_buflen += 8;
		_length += 1;
		while (_buflen >= 6) {
			writeEncoded(_buffer >>> _buflen - 6);
			_buflen -= 6;
		}
	};
	_this.flush = function() {
		if (_buflen > 0) {
			writeEncoded(_buffer << 6 - _buflen);
			_buffer = 0;
			_buflen = 0;
		}
		if (_length % 3 != 0) {
			const padlen = 3 - _length % 3;
			for (let i = 0; i < padlen; i += 1) _base64 += "=";
		}
	};
	_this.toString = function() {
		return _base64;
	};
	return _this;
};
const base64DecodeInputStream = function(str) {
	const _str = str;
	let _pos = 0;
	let _buffer = 0;
	let _buflen = 0;
	const _this = {};
	_this.read = function() {
		while (_buflen < 8) {
			if (_pos >= _str.length) {
				if (_buflen == 0) return -1;
				throw "unexpected end of file./" + _buflen;
			}
			const c = _str.charAt(_pos);
			_pos += 1;
			if (c == "=") {
				_buflen = 0;
				return -1;
			} else if (c.match(/^\s$/)) continue;
			_buffer = _buffer << 6 | decode(c.charCodeAt(0));
			_buflen += 6;
		}
		const n = _buffer >>> _buflen - 8 & 255;
		_buflen -= 8;
		return n;
	};
	const decode = function(c) {
		if (65 <= c && c <= 90) return c - 65;
		else if (97 <= c && c <= 122) return c - 97 + 26;
		else if (48 <= c && c <= 57) return c - 48 + 52;
		else if (c == 43) return 62;
		else if (c == 47) return 63;
		else throw "c:" + c;
	};
	return _this;
};
const gifImage = function(width, height) {
	const _width = width;
	const _height = height;
	const _data = new Array(width * height);
	const _this = {};
	_this.setPixel = function(x, y, pixel) {
		_data[y * _width + x] = pixel;
	};
	_this.write = function(out) {
		out.writeString("GIF87a");
		out.writeShort(_width);
		out.writeShort(_height);
		out.writeByte(128);
		out.writeByte(0);
		out.writeByte(0);
		out.writeByte(0);
		out.writeByte(0);
		out.writeByte(0);
		out.writeByte(255);
		out.writeByte(255);
		out.writeByte(255);
		out.writeString(",");
		out.writeShort(0);
		out.writeShort(0);
		out.writeShort(_width);
		out.writeShort(_height);
		out.writeByte(0);
		const lzwMinCodeSize = 2;
		const raster = getLZWRaster(lzwMinCodeSize);
		out.writeByte(lzwMinCodeSize);
		let offset = 0;
		while (raster.length - offset > 255) {
			out.writeByte(255);
			out.writeBytes(raster, offset, 255);
			offset += 255;
		}
		out.writeByte(raster.length - offset);
		out.writeBytes(raster, offset, raster.length - offset);
		out.writeByte(0);
		out.writeString(";");
	};
	const bitOutputStream = function(out) {
		const _out = out;
		let _bitLength = 0;
		let _bitBuffer = 0;
		const _this = {};
		_this.write = function(data, length) {
			if (data >>> length != 0) throw "length over";
			while (_bitLength + length >= 8) {
				_out.writeByte(255 & (data << _bitLength | _bitBuffer));
				length -= 8 - _bitLength;
				data >>>= 8 - _bitLength;
				_bitBuffer = 0;
				_bitLength = 0;
			}
			_bitBuffer = data << _bitLength | _bitBuffer;
			_bitLength = _bitLength + length;
		};
		_this.flush = function() {
			if (_bitLength > 0) _out.writeByte(_bitBuffer);
		};
		return _this;
	};
	const getLZWRaster = function(lzwMinCodeSize) {
		const clearCode = 1 << lzwMinCodeSize;
		const endCode = (1 << lzwMinCodeSize) + 1;
		let bitLength = lzwMinCodeSize + 1;
		const table = lzwTable();
		for (let i = 0; i < clearCode; i += 1) table.add(String.fromCharCode(i));
		table.add(String.fromCharCode(clearCode));
		table.add(String.fromCharCode(endCode));
		const byteOut = byteArrayOutputStream();
		const bitOut = bitOutputStream(byteOut);
		bitOut.write(clearCode, bitLength);
		let dataIndex = 0;
		let s = String.fromCharCode(_data[dataIndex]);
		dataIndex += 1;
		while (dataIndex < _data.length) {
			const c = String.fromCharCode(_data[dataIndex]);
			dataIndex += 1;
			if (table.contains(s + c)) s = s + c;
			else {
				bitOut.write(table.indexOf(s), bitLength);
				if (table.size() < 4095) {
					if (table.size() == 1 << bitLength) bitLength += 1;
					table.add(s + c);
				}
				s = c;
			}
		}
		bitOut.write(table.indexOf(s), bitLength);
		bitOut.write(endCode, bitLength);
		bitOut.flush();
		return byteOut.toByteArray();
	};
	const lzwTable = function() {
		const _map = {};
		let _size = 0;
		const _this = {};
		_this.add = function(key) {
			if (_this.contains(key)) throw "dup key:" + key;
			_map[key] = _size;
			_size += 1;
		};
		_this.size = function() {
			return _size;
		};
		_this.indexOf = function(key) {
			return _map[key];
		};
		_this.contains = function(key) {
			return typeof _map[key] != "undefined";
		};
		return _this;
	};
	return _this;
};
const createDataURL = function(width, height, getPixel) {
	const gif = gifImage(width, height);
	for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) gif.setPixel(x, y, getPixel(x, y));
	const b = byteArrayOutputStream();
	gif.write(b);
	const base64 = base64EncodeOutputStream();
	const bytes = b.toByteArray();
	for (let i = 0; i < bytes.length; i += 1) base64.writeByte(bytes[i]);
	base64.flush();
	return "data:image/gif;base64," + base64;
};
const stringToBytes = qrcode.stringToBytes;

// src/client/index.tsx
const name = "meshy-dsh-client";
const inject = ["slots", "locale"];
const NS = "meshy";
const GLB_ID = "meshy-dsh/glb";
/** The left-sidebar entry and its page in the main column share this id. */
const PAGE_ID = "meshy";
const EXAMPLES = [
	"chest",
	"photo",
	"character",
	"print"
];
const SITES = {
	global: {
		web: "https://www.meshy.ai",
		docs: "https://docs.meshy.ai",
		host: "meshy.ai"
	},
	cn: {
		web: "https://meshy.cn",
		docs: "https://docs.meshy.cn",
		host: "meshy.cn"
	}
};
const CN_ZONES = /* @__PURE__ */ new Set([
	"Asia/Shanghai",
	"Asia/Chongqing",
	"Asia/Chungking",
	"Asia/Harbin",
	"Asia/Urumqi",
	"Asia/Kashgar",
	"PRC"
]);
function guessSite() {
	try {
		return CN_ZONES.has(Intl.DateTimeFormat().resolvedOptions().timeZone) ? "cn" : "global";
	} catch {
		return "global";
	}
}
let currentSite = guessSite();
const siteListeners = /* @__PURE__ */ new Set();
function setSite(next) {
	if (next === currentSite) return;
	currentSite = next;
	for (const notify of siteListeners) notify();
}
function useSite() {
	return (0, react.useSyncExternalStore)((notify) => {
		siteListeners.add(notify);
		return () => {
			siteListeners.delete(notify);
		};
	}, () => currentSite);
}
/** Docs in the reader's language on the global site; the China site serves Chinese by default. */
function docsUrl(site) {
	return site === "global" && /^zh/i.test(globalThis.navigator?.language ?? "") ? `${SITES.global.docs}/zh` : SITES[site].docs;
}
const en = {
	nav: "Meshy",
	accountTitle: "Meshy account",
	summary: "Sign in to Meshy and preview GLB models in 3D.",
	tagline: "Text and images to 3D models, right in DeepSeek Harness",
	checking: "Checking…",
	signedIn: "Signed in",
	signedOut: "Not signed in",
	unverified: "Needs attention",
	"unverified.hint": "The saved sign-in could not be verified. Refresh, or sign in again.",
	site: "Site",
	"site.global": "Global",
	"site.cn": "China",
	credits: "Credits",
	"credits.get": "Get credits",
	account: "Account",
	more: "Manage account",
	signIn: "Sign in to Meshy",
	"signIn.hint": "Approve in your browser once; the Meshy skills then use this sign-in.",
	"signIn.scan": "Scan with your phone, or open the link",
	"signIn.scanHint": "Sign in to {host} and approve. This page finishes on its own.",
	"signIn.code": "Code",
	"signIn.open": "Open in browser",
	"signIn.waiting": "Waiting for your approval…",
	copy: "Copy code",
	copied: "Copied",
	cancel: "Cancel",
	retry: "Try again",
	refresh: "Refresh",
	signOut: "Sign out",
	"signOut.title": "Sign out of Meshy?",
	"signOut.body": "The Meshy skills in DeepSeek Harness will ask you to sign in again before they generate.",
	close: "Close",
	cli: "Meshy CLI {version}",
	"cli.temporary": "run through npm exec",
	"error.cli": "Meshy CLI not found",
	"error.cliHint": "Install Node.js 22.12 or newer, then run this and refresh:",
	"error.expired": "The code expired. Start again for a new one.",
	"error.generic": "Something went wrong: {message}",
	"viewer.title": "3D model",
	"viewer.loading": "Loading model…",
	"viewer.failed": "This model cannot be shown",
	"viewer.triangles": "{count} triangles",
	"viewer.reset": "Reset view",
	"viewer.spin": "Auto-rotate",
	"viewer.stop": "Stop rotating",
	"page.tagline": "Turn text and images into 3D models, rig and animate them, or get them ready to print.",
	"page.start": "Start creating",
	"page.startHint": "Pick one to open a new session with it filled in. Edit it, then send.",
	"page.copyHint": "Copy one into a session, edit it, then send.",
	"page.try": "Start a session",
	"page.docs": "Documentation",
	"page.site": "Meshy website",
	"example.chest.title": "Game asset",
	"example.chest.prompt": "Make a low-poly cartoon treasure chest for my game and export it as GLB.",
	"example.photo.title": "Photo to 3D",
	"example.photo.prompt": "Turn the photo I attach into a textured 3D model.",
	"example.character.title": "Animated character",
	"example.character.prompt": "Create a cartoon knight, rig it, add a walking animation and export FBX.",
	"example.print.title": "3D print",
	"example.print.prompt": "Make a 10 cm tall shiba inu figurine and prepare a print-ready 3MF."
};
const zh = {
	nav: "Meshy",
	accountTitle: "Meshy 账号",
	summary: "登录 Meshy，并在 3D 中预览 GLB 模型。",
	tagline: "在 DeepSeek Harness 里用文字或图片生成 3D 模型",
	checking: "检查中…",
	signedIn: "已登录",
	signedOut: "未登录",
	unverified: "需要处理",
	"unverified.hint": "已保存的登录无法验证。请刷新，或重新登录。",
	site: "站点",
	"site.global": "国际站",
	"site.cn": "中国站",
	credits: "积分",
	"credits.get": "获取积分",
	account: "账号",
	more: "管理账号",
	signIn: "登录 Meshy",
	"signIn.hint": "在浏览器里批准一次，Meshy 技能之后都会使用这个登录。",
	"signIn.scan": "用手机扫码，或打开链接",
	"signIn.scanHint": "登录 {host} 并批准，本页会自动完成。",
	"signIn.code": "验证码",
	"signIn.open": "在浏览器中打开",
	"signIn.waiting": "正在等待你的批准…",
	copy: "复制验证码",
	copied: "已复制",
	cancel: "取消",
	retry: "重试",
	refresh: "刷新",
	signOut: "退出登录",
	"signOut.title": "退出 Meshy 登录？",
	"signOut.body": "退出后，DeepSeek Harness 里的 Meshy 技能在生成前会要求你重新登录。",
	close: "关闭",
	cli: "Meshy CLI {version}",
	"cli.temporary": "通过 npm exec 运行",
	"error.cli": "找不到 Meshy CLI",
	"error.cliHint": "请安装 Node.js 22.12 或更新版本，运行下面的命令后刷新：",
	"error.expired": "验证码已过期，请重新开始。",
	"error.generic": "出错了：{message}",
	"viewer.title": "3D 模型",
	"viewer.loading": "正在加载模型…",
	"viewer.failed": "无法显示这个模型",
	"viewer.triangles": "{count} 个三角面",
	"viewer.reset": "重置视角",
	"viewer.spin": "自动旋转",
	"viewer.stop": "停止旋转",
	"page.tagline": "用文字或图片生成 3D 模型，绑骨做动画，或者准备好直接 3D 打印。",
	"page.start": "开始创作",
	"page.startHint": "选一个，会新开一个会话并填好需求，改一改再发送。",
	"page.copyHint": "复制到会话里，改一改再发送。",
	"page.try": "新开会话",
	"page.docs": "文档",
	"page.site": "Meshy 官网",
	"example.chest.title": "游戏资产",
	"example.chest.prompt": "做一个低多边形的卡通宝箱，用在我的游戏里，导出 GLB。",
	"example.photo.title": "照片转 3D",
	"example.photo.prompt": "把我附上的这张照片做成带贴图的 3D 模型。",
	"example.character.title": "动画角色",
	"example.character.prompt": "生成一个卡通骑士，绑骨并加上走路动画，导出 FBX。",
	"example.print.title": "3D 打印",
	"example.print.prompt": "做一个 10 厘米高的柴犬手办，并准备好可以直接打印的 3MF。"
};
const CSS = `
.meshy-root{--meshy-accent:#beef54;--meshy-accent-hover:#b1ed30;--meshy-accent-label:#000;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);font-size:13px;line-height:22px}
body[data-ds-dark-theme] .meshy-root{--meshy-accent:#c5f955;--meshy-accent-hover:#a8e328}
.meshy-section{display:flex;flex-direction:column;gap:16px;padding:8px 0}
.meshy-card{border:.5px solid var(--dsw-alias-settings-card-stroke);border-radius:var(--dsw-radius-xl);background:var(--dsw-alias-settings-card-fill);padding:12px 16px}
.meshy-head,.meshy-row{display:flex;justify-content:space-between;align-items:center;gap:16px}
.meshy-identity{display:flex;align-items:center;gap:10px;min-width:0;min-height:44px}
.meshy-logo{width:32px;height:32px;flex:none;border-radius:9px}
.meshy-copy{display:flex;flex-direction:column;min-width:0}
.meshy-name{font-size:14px;font-weight:500}
.meshy-muted{color:var(--dsw-alias-label-tertiary)}
.meshy-small{font-size:12px;line-height:18px}
.meshy-pill{display:inline-flex;align-items:center;gap:6px;flex:none;white-space:nowrap}
.meshy-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-tertiary)}
.meshy-dot[data-on]{background:var(--meshy-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--meshy-accent) 25%,transparent)}
.meshy-dot[data-warn]{background:var(--dsw-alias-state-warn-primary)}
.meshy-rows{display:flex;flex-direction:column;gap:8px}
.meshy-row{box-sizing:border-box;min-height:40px;padding:6px 0}
.meshy-divider{border-top:.5px solid var(--dsw-alias-border-l2)}
.meshy-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:10px}
.meshy-amount{display:inline-flex;align-items:center;gap:8px;font-size:18px;font-weight:510;line-height:28px}
.meshy-coin{width:12px;height:12px;border-radius:50%;background:linear-gradient(135deg,#f9e855,#e99430)}
.meshy-link{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:36px;padding:0 14px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px;text-decoration:none;white-space:nowrap}
.meshy-link:hover{background:var(--dsw-alias-interactive-bg-hover)}
.meshy-link:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.meshy-root .meshy-accent{flex:none;white-space:nowrap;border-color:transparent;background:var(--meshy-accent);color:var(--meshy-accent-label);font-weight:500}
.meshy-root .meshy-accent:hover:not(:disabled){background:var(--meshy-accent-hover)}
.meshy-signin{display:flex;align-items:center;gap:20px}
.meshy-qr{flex:none;width:136px;height:136px;padding:10px;border-radius:var(--dsw-radius-lg);background:#fff;border:.5px solid var(--dsw-alias-border-l2);image-rendering:pixelated}
.meshy-signin .meshy-copy{gap:10px}
.meshy-code{display:inline-flex;align-items:center;gap:8px}
.meshy-code code{font-family:var(--ds-font-family-code);font-size:16px;letter-spacing:.08em;padding:2px 10px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-module-platform)}
.meshy-waiting{display:inline-flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary)}
.meshy-alert{display:flex;align-items:flex-start;gap:8px;padding:10px 12px;border-radius:var(--dsw-radius-lg);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 10%,transparent)}
.meshy-alert svg{flex:none;margin-top:3px;color:var(--dsw-alias-state-warn-primary)}
.meshy-alert code{align-self:flex-start;margin-top:4px;padding:1px 6px;border-radius:var(--dsw-radius-xs);font-family:var(--ds-font-family-code);font-size:12px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}
.meshy-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 4px}
.meshy-skeleton{display:block;border-radius:6px;background:var(--dsw-alias-bg-skeleton);animation:meshy-pulse 1.4s ease-in-out infinite}
@keyframes meshy-pulse{50%{opacity:.45}}
.meshy-viewer{position:relative;width:100%;height:100%;min-height:360px}
.meshy-stage{position:absolute;inset:0}
.meshy-overlay{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:16px;text-align:center}
.meshy-overlay .meshy-logo{width:40px;height:40px;animation:meshy-pulse 1.4s ease-in-out infinite}
.meshy-bar{position:absolute;left:12px;right:12px;bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:8px;pointer-events:none}
.meshy-bar>*{pointer-events:auto}
.meshy-chip{padding:2px 10px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 80%,transparent);backdrop-filter:blur(8px);font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.meshy-page{box-sizing:border-box;height:100%;overflow-y:auto}
.meshy-page-inner{box-sizing:border-box;max-width:760px;margin:0 auto;padding:56px 32px 48px;display:flex;flex-direction:column;gap:32px}
.meshy-hero{display:flex;align-items:center;gap:16px}
.meshy-hero .meshy-logo{width:56px;height:56px;border-radius:14px}
.meshy-hero h1{margin:0;font-size:24px;font-weight:600;line-height:32px;color:var(--dsw-alias-label-primary)}
.meshy-h2{margin:0;font-size:15px;font-weight:500;line-height:24px}
.meshy-block{display:flex;flex-direction:column;gap:12px}
.meshy-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.meshy-example{box-sizing:border-box;display:flex;flex-direction:column;align-items:flex-start;gap:6px;width:100%;margin:0;padding:14px 16px;border:.5px solid var(--dsw-alias-settings-card-stroke);border-radius:var(--dsw-radius-xl);background:var(--dsw-alias-settings-card-fill);color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer;transition:background-color .15s,border-color .15s}
.meshy-example:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:color-mix(in srgb,var(--meshy-accent) 70%,transparent)}
.meshy-example:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.meshy-example-title{display:inline-flex;align-items:center;gap:8px;font-weight:500}
.meshy-example-title::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--meshy-accent)}
.meshy-example-cta{display:inline-flex;align-items:center;gap:4px;margin-top:4px;font-size:12px;color:var(--dsw-alias-label-tertiary)}
.meshy-example:hover .meshy-example-cta{color:var(--dsw-alias-label-primary)}
.meshy-links{display:flex;gap:16px}
.meshy-textlink{display:inline-flex;align-items:center;gap:4px;color:var(--dsw-alias-label-secondary);text-decoration:none}
.meshy-textlink:hover{color:var(--dsw-alias-label-primary)}
.meshy-mark{display:inline-flex;flex:none}
.meshy-tools{display:flex;gap:4px;padding:2px;border-radius:var(--dsw-radius-md);background:color-mix(in srgb,var(--dsw-alias-bg-base) 80%,transparent);backdrop-filter:blur(8px)}
`;
if (typeof document !== "undefined" && !document.querySelector("style[data-plugin-css=\"meshy-dsh/client.css\"]")) {
	const tag = document.createElement("style");
	tag.dataset.plugin = "meshy-dsh";
	tag.dataset.pluginCss = "meshy-dsh/client.css";
	tag.textContent = CSS;
	document.head.append(tag);
}
async function api(path, body) {
	const res = await fetch(`api/${path}`, body === void 0 ? { cache: "no-store" } : {
		method: "POST",
		cache: "no-store",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body)
	});
	return {
		status: res.status,
		data: await res.json().catch(() => ({}))
	};
}
function qr(text) {
	const code = qrcode(0, "M");
	code.addData(text);
	code.make();
	return code.createDataURL(6, 0);
}
const Logo = () => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
	className: "meshy-logo",
	src: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgdmlld0JveD0iMCAwIDEyOCAxMjgiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgY2xpcC1ydWxlPSJldmVub2RkIiBkPSJNMjguNTkzNCA0NC44NTA0QzI5Ljg1ODYgNDEuODgxNyAzMS40MzggMzguOTU4OSAzMy4zMTI0IDM2LjE2MDJMMzMuMzQ0MSAzNi4xMTIyTDMzLjM0NDMgMzYuMTExOUMzMy41NDgzIDM1LjgwMjggMzMuNzU0NSAzNS40OTcgMzMuOTYyNiAzNS4xOTQ1QzQ2LjI4MjQgMTYuMDg1NSA3Mi43MzI0IDQuNjM0NzQgOTUuMDk1NyAxNC43Nzg3QzExMi43NyAyMi4zNDM2IDEyMS4yNCAzNy43OTEzIDEyMC45OTYgNTEuNTQ0N0MxMjAuODczIDU4LjQwMjggMTE4LjU1NSA2NS4wOTMzIDExMy43NjkgNjkuOTI5N0MxMTIuOTQ5IDcwLjc1NzUgMTEyLjA3MiA3MS41MTY0IDExMS4xNCA3Mi4yMDI1QzExNS40NTkgNzUuNjMxNyAxMTguMjg0IDc5LjgwMjEgMTE5LjAxOCA4NC42NzUxQzEyMC4xMTUgOTEuOTY3MyAxMTYuMTgxIDk4LjQ4NDYgMTEwLjY0MyAxMDMuMjkzQzk5LjU2MiAxMTIuOTEzIDc4Ljc5NzMgMTE4Ljk0MiA1NS4xNDQ2IDExNi40MjhDNTEuMjE1IDExNi4wNzEgMzcuMDE5MiAxMTMuMjggMzMuNzg3MSAxMDguMDkzQzMyLjA3NzMgMTA3LjI2OCAzMC41MTYzIDEwNi4yOSAyOS4xNjc3IDEwNS4xNDJDMjYuOTU3MiAxMDMuMjU5IDI1LjEzMTQgMTAwLjc0NiAyNC40NTg1IDk3LjU3NjVDMjMuNDc5MiA5Mi45NjUgMjYuMDExNSA4NS4xMzA3IDMxLjI2OTMgODIuODg5N0MzMy4xNjAzIDkyLjE3NTYgMzkuOTAyNyA5Mi43Mzg5IDQ0LjkwOTIgOTMuMjYyQzQ2Ljk1OTYgOTEuNTQwNCA0Ny45NDc1IDkwLjU2NTYgNTAuMDExMiA4Ny45ODM0QzQ2LjAwNTkgODguMzA2NSA0MC45MjE2IDg3LjIxNDMgMzcuMDE5MiA4NS4xMzA3QzI5Ljg2MSA4MS4zMDg1IDI1LjU0ODggNzQuMjg4NyAyNS4wNzk0IDY0LjI2MDdDMjQuNjE0NCA1Ny42OTEzIDI2LjAyNTggNTAuODc0OCAyOC41OTM0IDQ0Ljg1MDRaTTM4LjY1MDggMzguMzAwNEMzOC40NDY5IDM4LjU5NTkgMzguMjQ0OCAzOC44OTUxIDM4LjA0NDkgMzkuMTk4MUMzOC4wMzEzIDM5LjIxODYgMzguMDE3OCAzOS4yMzkyIDM4LjAwNDMgMzkuMjU5N0MzNi4zMTc2IDQxLjc3NTUgMzQuOTAyIDQ0LjM5NiAzMy43NzI2IDQ3LjA0NkMzMy43NzcyIDQ3LjA4NzIgMzMuNzgyIDQ3LjEyODEgMzMuNzg3MSA0Ny4xNjg5QzMxLjQ2MDQgNTIuNzQwMSAzMC4zNzE3IDU4LjQyNTkgMzAuNjcxOCA2My41MzY1QzMwLjY4MDcgNjMuNjg3NiAzMC42OTA3IDYzLjgzODMgMzAuNzAyMSA2My45ODgzTDMwLjcwMyA2NC4wMDA3TDMwLjcwMDQgNjMuOTg4N0wzMC43MDEgNjQuMDAxMUMzMC43MDY5IDY0LjEyNTcgMzAuNzEzNCA2NC4yNDk2IDMwLjcyMDYgNjQuMzcyN0MzMS41NDUgNzguNTA1MiA0MS4xOTI0IDgzLjAzMDcgNTMuMDQ2OSA4Mi44ODk3QzU0Ljk2NjkgODIuODY2OCA1Ni45NDQ5IDgyLjcyMTYgNTguOTUyNiA4Mi40NzQ5QzU4LjQzNTUgODQuNzAwNiA1Ny44NTU1IDg2LjYyNzYgNTcuMTIwNiA4OC4zMDY1QzU2LjA2NzIgOTAuNzEyNyA1NC42OTU2IDkyLjYwOTEgNTIuNzM0NiA5NC4xNDQxQzU5LjgwMTEgOTQuNjc4NyA2Ny40NTE3IDkzLjYzNjMgNzQuMjk5OCA5MS41NDA0QzgzLjc2MDYgOTAuODQ3OCA5OC40NDE2IDg1LjQyMzMgOTUuNDYxMyA3NC45NjczTDk1LjQ2MTYgNzQuOTY3MUM5NS40MTI4IDc0Ljc5NTkgOTUuMzU5MyA3NC42MjM0IDk1LjMwMSA3NC40NDk1Qzk0Ljk4MTEgNzMuMjYyOCA5NC41OTczIDcyLjEwODEgOTQuMjA1NiA3MS4wMTU3TDk0LjE3NjEgNzAuOTMzNkw5NC4yMTA0IDcwLjk2NzJDOTYuMzE4NSA3MS4xNzQ1IDk4LjI4MDEgNzEuMTE4NSAxMDAuMDkgNzAuODMyN0MxMDAuMjM4IDcwLjgwOTMgMTAwLjM4NSA3MC43ODQ1IDEwMC41MyA3MC43NTgxQzEwMC44NTIgNzAuNjk5OSAxMDEuMTY5IDcwLjYzNDMgMTAxLjQ4MSA3MC41NjE1QzEwMS44MDQgNzAuNDg2IDEwMi4xMjIgNzAuNDAyOCAxMDIuNDM1IDcwLjMxMjFDMTAzLjUyIDY5Ljk5NzQgMTA0LjU0IDY5LjU5MjQgMTA1LjQ5NCA2OS4xMDYyQzEwNS41MDUgNjkuMTAxMSAxMDUuNTE1IDY5LjA5NTkgMTA1LjUyNSA2OS4wOTA4QzEwNS41MzQgNjkuMDg1OCAxMDUuNTQ0IDY5LjA4MDkgMTA1LjU1NCA2OS4wNzU5TDEwNS41NTUgNjkuMDc1MkMxMDUuNzA3IDY4Ljk5NyAxMDUuODU4IDY4LjkxNjYgMTA2LjAwNiA2OC44MzQyQzEyMS4xNTggNjAuNDQyMiAxMTguNzI5IDMwLjk2MDggOTIuODIwNCAxOS45MTI2QzczLjUwMjUgMTEuMTEyIDQ5Ljc5MyAyMC45NDM1IDM4LjY1MDggMzguMzAwNFpNMTAxLjI5MSA3Mi43Mzg3QzExMi44MTYgODYuMDgzNiAxMDEuNDQ2IDk4LjIwMjMgODMuNDg4OSAxMDQuODYzQzkwLjE2NTUgMTAwLjU0OSA5NS42NDY5IDkzLjc5NCA5OC45NDg1IDg0LjAwMjVDNzguOTcwOCAxMDIuOTAyIDMzLjEzMTYgMTA0Ljg1OCAzMC45OTQ2IDkyLjE3NTZDMzAuOTU0NCA5MS43MzA2IDMwLjkzMzkgOTEuMjY5OSAzMC45MzM2IDkwLjc5MzFMMzAuOTM0MiA5MC43ODQzQzI2LjMzNjUgOTkuODIwNCAzNi41MTg2IDEwNS40MTQgNTAuNDYxMiAxMDYuMjI0QzUwLjUyMTEgMTA2LjIyNyA1MC41ODExIDEwNi4yMzEgNTAuNjQxMSAxMDYuMjM0QzUwLjkzMDYgMTA2LjI1IDUxLjIyMTggMTA2LjI2NCA1MS41MTQ0IDEwNi4yNzVDNTMuMDExNiAxMDYuMzM2IDU0LjU0NzkgMTA2LjM0MiA1Ni4xMTAyIDEwNi4yOTNDNTYuMTM1NSAxMDYuMjkyIDU2LjE2MDcgMTA2LjI5MSA1Ni4xODYgMTA2LjI5QzU4LjQwNjkgMTA2LjIxNyA2MC42Nzk5IDEwNi4wMzIgNjIuOTY3MyAxMDUuNzI5QzcxLjE5MDggMTA0LjY0MiA3OS42MDE1IDEwMi4wNDEgODYuNDUwNCA5Ny43MTMxQzgyLjYwMzggMTAxLjA1NyA3OC44NDM2IDEwMy40OTQgNzUuMDEzMyAxMDUuMjgyQzY4Ljk4NTkgMTA4LjA5NSA2Mi43ODUgMTA5LjI5NyA1NS44MDA2IDEwOS44ODJMNTUuNzg0NSAxMDkuODg0QzU0LjE3NzggMTEwLjAxOCA1Mi41Mjk2IDExMC4xMiA1MC44MzI1IDExMC4yMDJDNTIuNDQ5IDExMC40ODEgNTQuMDczMyAxMTAuNjk2IDU1LjY5NzYgMTEwLjg0M0M1OC4yNjI2IDExMS4xMTYgNjAuNzgxOSAxMTEuMjgzIDYzLjI0NjggMTExLjM1MkM2Ny44OTQgMTExLjQ4MiA3Mi4zNDc3IDExMS4yNjMgNzYuNTUwMSAxMTAuNzUyQzEwNi4zMjYgMTA3LjEzMyAxMjMuNDgzIDg4Ljg3NjEgMTA3LjQwOSA3Ni40MTA3QzEwNi44NjIgNzUuOTg2NCAxMDYuMjc2IDc1LjU2ODcgMTA1LjY1MSA3NS4xNTg2QzEwNC4zNjggNzQuMzE2NCAxMDIuOTE5IDczLjUwNTkgMTAxLjI5NyA3Mi43MzQxTDEwMS4yODEgNzIuNzI2OEwxMDEuMjkxIDcyLjczODZMMTAxLjI5MSA3Mi43Mzg3WiIgZmlsbD0iI0M1Rjk1NSIvPgo8cGF0aCBkPSJNMzguMDQ0NyAzOS4xOTgyQzI0Ljc2MDQgNTkuMzI2MyAyOC4yOTY0IDg1Ljk1MTggNTYuOTIyNCA4MS4yMzM1TDg1LjMwMiA3MS44OTE3QzExMS44ODEgNjMuMDQ2NyAxMTMuMTUxIDM1Ljk0MjQgOTYuMzgyMSAyMy45OTQ5QzgzLjY3NTIgMTQuOTQxMSA1NC4yMjgxIDE0LjY3OTcgMzguMDQ0NyAzOS4xOTgyWiIgZmlsbD0iI0ZGM0U4RiIvPgo8cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTUyLjg3NjUgNTUuMDM4MUM2NS40ODI3IDUxLjYyNzMgNzguODI3NyAzNy4xMzE2IDgwLjg3OTkgMTguNTQ5MkM3Ni41MTQ3IDE4LjE0NTYgNzEuNjU5MiAxOC40NDIxIDY2LjM0ODkgMTkuNjEzMkM1MC4zNjQ3IDIzLjEzODkgMzkuMDAwMyAzNC43Nzc0IDMzLjc3MTUgNDcuMDQ2QzM0LjgzMjYgNTYuNTUxOSA0OS41NjUxIDU1LjkzNTYgNTIuODc2NSA1NS4wMzgxWiIgZmlsbD0iI0M1Rjk1NSIvPgo8cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTUyLjg3NzUgNTUuMDM4QzY1LjQ4MzYgNTEuNjI3MiA3Ny4yODQgMzcuNjY2NCA3OS4zMzYyIDE5LjA4NDFMNzUuNzE3MyAxOS45NDk3QzY5Ljg3NDggNDAuOTQ2IDUzLjQxNzQgNTUuNjgxNCAzOC42Mzg5IDUxLjU3NzhDNDAuODIyIDU1LjYyNDIgNTEuMTcxOCA1NS41MDAzIDUyLjg3NzUgNTUuMDM4WiIgZmlsbD0iIzY3QjgwMCIvPgo8cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTc1Ljg1MTggMjIuOTY3MUM1OS4xNzM0IDE5LjYyNTcgMzkuNTA4OSAzMC4xNTgzIDM0Ljg0MjggNDguMzI3NkM0MS42MjIgMzUuMzE2NCA2MC4zMjk5IDIzLjU4OCA3NS44NTE4IDIyLjk2NzFaIiBmaWxsPSIjRTlGRkNFIi8+CjxwYXRoIGQ9Ik0xMDkuNDc0IDM5LjY2MDdMODMuOTEyOSA3NC43ODgzTDU3Ljg2OTEgODAuMjg3MUM1Ny41OTA1IDgwLjQ4OTcgNTcuMzQwNSA4MC40MDIxIDU3LjMzNDYgODAuNDAwMUw1Ny4zMzQ0IDgwLjRMNTcuODY5MSA4MC4yODcxQzU4LjI5MjEgNzkuOTc5NiA1OC43ODA4IDc5LjAwMzEgNTguNTgwMSA3Ni4wNDI4QzU4LjAzOTYgNzQuNTA5IDU3LjY3NiA3MC44OTMyIDU0LjAwMjIgNjguNDMzOEM1Mi4yMzgyIDY3LjI1MjkgNTAuNTY4MiA2NS42ODI2IDUwLjg2MDkgNjMuNThDNTEuMTQ5NiA2MS41MDUyIDUzLjAyMTQgNjAuMjc1MyA1NS4wNTgyIDU5Ljc4NThDNzIuNjYgNTUuNTU1NCA4MC43OTUgMzcuNTMzNSA4Mi42MDI1IDIwLjUwNDhMOTguMDE3NSAyNy4xNzk0TDEwOS40NzQgMzkuNjYwN1oiIGZpbGw9IiNDOTFDNjUiLz4KPHBhdGggZD0iTTkzLjQyMTUgNjIuMDMxNUM4Mi43NzI0IDU3LjQ1MTQgODcuOTk4MiAzNy40NjY4IDEwMC4zMTEgMzIuNzUyQzEwMC4zMTUgMzIuNzU4IDEwMC4zMTkgMzIuNzY0MSAxMDAuMzI0IDMyLjc3MDFDOTIuODE1NCAzOC44NjYxIDkxLjUwNTUgNTIuMDcxOCA5Ny40NDMyIDU4LjM3ODZDOTYuNjA3MSA1OS4yODQ0IDk1LjY4NTMgNjAuMTc5MiA5NC42NzUzIDYxLjA1OTFDOTQuMjc1MiA2MS4zODExIDkzLjg1NjkgNjEuNzA1NSA5My40MjE1IDYyLjAzMTVaIiBmaWxsPSIjNEM4NzAwIi8+CjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgY2xpcC1ydWxlPSJldmVub2RkIiBkPSJNMzIuMjg4NiA2OS42NzY4QzQxLjIzMjkgNjguNDE4MyA1NS44MDgzIDcyLjE3NDIgNTYuMjkyMiA4MC4yNzMyQzQ2LjI3ODQgODAuODUxIDM1LjQ4MTYgNzUuNjQ3NiAzMi4yODg2IDY5LjY3NjhaIiBmaWxsPSIjNjdCODAwIi8+CjxwYXRoIGQ9Ik0zMy43MTM0IDcxLjczOTJDMzUuMDM4OSA3Mi42NjE0IDM2Ljk5NTcgNzMuNTA2MiAzOS43OTYzIDc0LjEwODNDNDMuOTExNiA3NC45OTMyIDQ4LjUwMjggNzQuNDI0NiA1MS43NDYgNzMuNTgzNUM0Ni42MTIzIDcwLjIxMDMgMzguMjE0NSA2OC44NDMgMzIuMjg4NiA2OS42NzY4QzMyLjY2MzMgNzAuMzc3NiAzMy4xNDI4IDcxLjA2NzcgMzMuNzEzNCA3MS43MzkyWiIgZmlsbD0iI0M1Rjk1NSIvPgo8cGF0aCBkPSJNNjIuMzQ0NSA3NC42Mzg5QzYzLjgyNjYgNTguNDA0MSA4Ni43NDkyIDU1Ljk3OTMgOTAuNDcxNCA2Ni4yMjcxQzkwLjc3NTQgNjcuMTQ2MyA5MS4xNTY3IDY4LjE0NzggOTEuNTU5NyA2OS4yMDYxQzkyLjY1OTEgNzIuMDkzMiA5My45MTk3IDc1LjQwMzcgOTQuMjExMSA3OC42MjQxQzg5Ljc2NjcgODYuNzY3IDc0LjE3MDMgOTMuNDUyOCA1OS4yNjMyIDk0LjIxMDlDNjMuNzg5MSA4NC42OTI4IDYyLjM0NDUgNzQuNjM4OSA2Mi4zNDQ1IDc0LjYzODlaIiBmaWxsPSJ3aGl0ZSIvPgo8cGF0aCBkPSJNODkuMzA2NSA4NS4wMTY1TDc0LjI0ODIgOTEuNTQyOUM4NC4zNzY4IDg2LjIzODYgODQuODk4NyA2My44NTk0IDc0LjA0OTYgNjYuMDk0Mkw4My4wNTQ5IDYyLjI1ODlMOTEuNDk0NSA2OS41ODVMODkuMzA2NSA4NS4wMTY1WiIgZmlsbD0iI0ZGOTdDMiIvPgo8cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTkyLjgyMDIgMTkuOTEyNEM4OS43NjM4IDE4LjUyIDg2LjQ1NDYgMTcuNTIzIDgyLjk4NTYgMTcuMDE5OUw4Mi45ODYxIDE3LjAxODFMODIuOTUyIDE3LjAxNUM2NS40NDg1IDE0LjQ5MyA0Ny41ODc5IDIzLjc2MDEgMzguMTc1OSAzOS4wNTUzQzQ3LjUwNjkgMjYuNTI4NyA2NC41MDI5IDE5LjI3NSA3OC41NzAxIDIxLjIzMTRDNzcuMzggMjguMzE3NSA3Mi44IDM4Ljg2OTQgNjQuNTAyOSA0Ni4zMzc1QzU2LjI2NzggNTMuNzQ5OCA0My43ODY1IDU2LjU0NTggMzYuMTM2OCA1MS45ODA2QzQxLjc3NiA1OC42ODM2IDU4LjkxMzIgNTcuODI1MSA2OC4yMjQ3IDQ5Ljc4MDdDNzYuOTU1IDQyLjIzODMgODIuMzY1MSAzMC40NDk3IDgzLjM2MDYgMjIuMjQ1OUM4My43NjggMjIuMzQ1MyA4NC4xNzA1IDIyLjQ1MDUgODQuNTY3OSAyMi41NjEyQzg4LjgxMzMgMjMuOTA4IDg5Ljk5MjMgMjcuNTYxMSA5MC4yNzg5IDMwLjExNjVDOTAuNDY4MyAzMS44MDQ2IDg5LjQyMjEgMzMuMjc3OSA4OC4xNzkgMzQuNDM5MUM4NS41NDY0IDM2Ljg5ODMgODIuOTIyNiA0MC44NjU5IDgxLjM5OTcgNDUuMTMyOUM3OS42ODA3IDQ5Ljk0OTIgNzcuMzg4NCA1NC45MjczIDczLjIxNyA1Ny44OTgzQzcxLjM1MTIgNTkuMjI3MiA2OS44NzExIDYwLjM3MDkgNjguNzMxNCA2MS4zNjczQzY0Ljc1NDQgNjMuOTg5NSA2MS42OTQxIDY4LjMwNSA2MC41MDY3IDc0LjQ3MkM2MC4zMzU2IDc1LjM2MDUgNjAuMjM5MyA3NS44ODAxIDYwLjEwMSA3Ni42NTIyQzQ2LjI1OTEgNzkuNDAzOCAzMy41IDc3LjI2MDEgMzAuNzAwMiA2My45ODg1QzMxLjQ3OSA4MC43NDAyIDQ0LjQzNzEgODQuMjU4MSA1OC45NTI0IDgyLjQ3NDdDNTcuNjk0IDg3Ljg5MDIgNTYuMDYzNyA5MS41Mzc5IDUyLjczNDMgOTQuMTQzOUM1NS4yNTU4IDk0LjMzNDcgNTcuODUxNiA5NC4zMjQ2IDYwLjQ1ODggOTQuMTM3NkM2Mi43MjUyIDkxLjMzMDQgNjMuNTA0IDg2LjM2OTEgNjQuMTY5NiA4Mi4xMjlMNjQuMTY5NyA4Mi4xMjg4QzY0LjMyMjYgODEuMTU0MyA2NC40Njk2IDgwLjIxNzkgNjQuNjI3MyA3OS4zNTQ1QzY0LjY5NjYgNzguOTYyMiA2NC43NzI2IDc4LjU3OSA2NC44NTUxIDc4LjIwNDlDNjQuOTE2OSA3Ny45MjAxIDY0Ljk4MTIgNzcuNjQ3IDY1LjA0ODcgNzcuMzg3MUg2NS4wNDkxQzY5LjM5MDggNjAuMzI2NSA4Ny42MDU2IDYzLjMzNzYgODguNDg5MyA3NS4xNDY2Qzg4LjUwOTggNzUuNDIwNCA4OC41MzIxIDc1LjY4NTkgODguNTUzOCA3NS45NDQ0Qzg4Ljk1MjUgODAuNjg1IDg5LjE1NDcgODMuMDkwMyA3NC4yNDczIDkxLjU0MzRMNzQuMjQ1OCA5MS41NDQxQzgzLjg1OTIgOTAuODU3MyA5OC45MzA3IDg1LjI2NDUgOTUuMzAwOCA3NC40NDk1Qzk0Ljk3MjkgNzMuMjMyOSA5NC41Nzc3IDcyLjA1IDk0LjE3NTggNzAuOTMzM0w5NC4yMTAxIDcwLjk2NjlDMTIxLjE0NSA3My42MTU5IDEyNC4xNjEgMzMuMjc3MiA5Mi44MjAyIDE5LjkxMjRaTTEwMC4zMTEgMzIuNzUxOEM4Ny45OTg0IDM3LjQ2NjYgODIuNzcyNiA1Ny40NTEyIDkzLjQyMTcgNjIuMDMxM0w5Ny40NDM0IDU4LjM3ODRDOTEuNTA1NyA1Mi4wNzE2IDkyLjgxNTYgMzguODY1OSAxMDAuMzI0IDMyLjc2OTlMMTAwLjMxMSAzMi43NTE4WiIgZmlsbD0iIzE4MTgxOCIvPgo8cGF0aCBkPSJNNTUuNjk3MyAxMTAuODQzQzEwMC45MzMgMTE1LjY3IDEzMS45MzUgODcuMjk3NiAxMDEuMjgxIDcyLjcyNjVDMTEyLjgyMyA4Ni4wNzYyIDEwMS40NTEgOTguMjAwMSA4My40ODkxIDEwNC44NjJDOTAuMTY1NyAxMDAuNTQ5IDk1LjY0NzEgOTMuNzkzOCA5OC45NDg3IDg0LjAwMjNDNzguMjY3IDEwMy41NjggMjkuODY5MiAxMDQuOTc1IDMwLjkzNDcgOTAuNzgwM0MyMi41NDI4IDEwNy4yNyA2My4zNjY2IDExMi4yOTkgODYuNDUwMiA5Ny43MTI5Qzc1LjE1MzggMTA3LjUzMiA2NC42MDI0IDEwOS41NDEgNTAuODMyMiAxMTAuMjAxQzUyLjQ0ODggMTEwLjQ4MSA1NC4wNzMxIDExMC42OTYgNTUuNjk3MyAxMTAuODQzWiIgZmlsbD0iIzE4MTgxOCIvPgo8cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTQ2LjY2MzQgNDguMjM2NEM0NC44ODc4IDQ4LjE5MTIgNDMuNjkyNyA0Ny4yOTM4IDQzLjk5NDIgNDYuMjMyQzQ0Ljg5MjEgNDMuMDY5NCA0NS41Njc4IDM4LjIwMzEgNDUuMjExNCAzNC4zMTA2QzQ1LjExNTYgMzMuMjY0NyA0Ni40OTU5IDMyLjI2MzcgNDguMjk0NCAzMi4wNzQ3QzUwLjA5MjkgMzEuODg1NyA1MS42Mjg1IDMyLjU4MDMgNTEuNzI0MyAzMy42MjYxQzUyLjExMDQgMzcuODQyMiA1MS4zODkyIDQyLjk5NzQgNTAuNDI0NCA0Ni4zOTU4QzUwLjEyMjkgNDcuNDU3NiA0OC40MzkxIDQ4LjI4MTcgNDYuNjYzNCA0OC4yMzY0WiIgZmlsbD0iIzE4MTgxOCIvPgo8cGF0aCBkPSJNNDQuMzQyMSA0Ny40MzU1QzQ0LjM0MjEgNDcuNDM1NSA0NS40MDU5IDQ4LjA3NyA0Ni45MzA2IDQ3LjI1OTdDNDkuMzkzNyA0NS45Mzk0IDQ5Ljk2ODQgMzcuOTg1MSA0OS45Njg0IDMzLjMzOTRDNDkuOTY4NCAzMi4wODQzIDQ4LjQyNCAzMi4wNjI2IDQ4LjQyNCAzMi4wNjI2QzUwLjE2NjEgMzEuOTE5NCA1MS42MzA5IDMyLjYwNTUgNTEuNzI0MyAzMy42MjYxQzUyLjExMDQgMzcuODQyMiA1MS4zODkyIDQyLjk5NzQgNTAuNDI0NCA0Ni4zOTU4QzUwLjEyMjkgNDcuNDU3NiA0OC40MzkxIDQ4LjI4MTcgNDYuNjYzNCA0OC4yMzY0QzQ1LjYzNjIgNDguMjEwMyA0NC44MDMzIDQ3Ljg5ODkgNDQuMzQyMSA0Ny40MzU1WiIgZmlsbD0iI0ZGM0U4RiIvPgo8cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGNsaXAtcnVsZT0iZXZlbm9kZCIgZD0iTTYwLjU2OSA0MS44NDIzQzU4Ljc5MzMgNDEuNzk3IDU3LjU5ODMgNDAuODk5NiA1Ny44OTk3IDM5LjgzNzhDNTguNzk3NiAzNi42NzUyIDU5LjQ3MzMgMzEuODA5IDU5LjExNjkgMjcuOTE2NEM1OS4wMjExIDI2Ljg3MDYgNjAuNDAxNSAyNS44Njk1IDYyLjIgMjUuNjgwNUM2My45OTg1IDI1LjQ5MTUgNjUuNTM0MSAyNi4xODYxIDY1LjYyOTggMjcuMjMxOUM2Ni4wMTU5IDMxLjQ0OCA2NS4yOTQ3IDM2LjYwMzIgNjQuMzI5OSA0MC4wMDE2QzY0LjAyODQgNDEuMDYzNCA2Mi4zNDQ2IDQxLjg4NzUgNjAuNTY5IDQxLjg0MjNaIiBmaWxsPSIjMTgxODE4Ii8+CjxwYXRoIGQ9Ik01OC4yNDc2IDQxLjA0MTNDNTguMjQ3NiA0MS4wNDEzIDU5LjMxMTQgNDEuNjgyOCA2MC44MzYxIDQwLjg2NTVDNjMuMjk5MiAzOS41NDUyIDYzLjg3MzkgMzEuNTkwOSA2My44NzM5IDI2Ljk0NTJDNjMuODczOSAyNS42OTAyIDYyLjMyOTUgMjUuNjY4NCA2Mi4zMjk1IDI1LjY2ODRDNjQuMDcxNiAyNS41MjUyIDY1LjUzNjQgMjYuMjExMyA2NS42Mjk4IDI3LjIzMTlDNjYuMDE1OSAzMS40NDggNjUuMjk0NyAzNi42MDMyIDY0LjMyOTkgNDAuMDAxNkM2NC4wMjg0IDQxLjA2MzQgNjIuMzQ0NiA0MS44ODc1IDYwLjU2OSA0MS44NDIzQzU5LjU0MTggNDEuODE2MSA1OC43MDg5IDQxLjUwNDcgNTguMjQ3NiA0MS4wNDEzWiIgZmlsbD0iI0ZGM0U4RiIvPgo8cGF0aCBkPSJNMjMuODk1MSAxMUwyNi41NjE3IDE4LjI1NDVMMzMuNzY4MiAyMC45Mzg5TDI2LjU2MTcgMjMuNjIzNEwyMy44OTUxIDMwLjg3NzlMMjEuMjI4NSAyMy42MjM0TDE0LjAyMiAyMC45Mzg5TDIxLjIyODUgMTguMjU0NUwyMy44OTUxIDExWiIgZmlsbD0iI0M1Rjk1NSIvPgo8cGF0aCBkPSJNMTIuNjI4NiAyOS43NzMzTDE0LjE0ODggMzMuOTM4TDE4LjI1NzIgMzUuNDc5TDE0LjE0ODggMzcuMDIwMUwxMi42Mjg2IDQxLjE4NDdMMTEuMTA4NCAzNy4wMjAxTDcgMzUuNDc5TDExLjEwODQgMzMuOTM4TDEyLjYyODYgMjkuNzczM1oiIGZpbGw9IiNDNUY5NTUiLz4KPC9zdmc+Cg==",
	alt: ""
});
function Identity({ t, page, line, pill }) {
	const title = page ? t("accountTitle") : "Meshy";
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "meshy-card meshy-head",
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "meshy-identity",
			children: [!page && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Logo, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "meshy-copy",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "meshy-name",
					children: title
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "meshy-muted",
					children: line
				})]
			})]
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
			className: "meshy-pill meshy-muted",
			children: [pill === "checking" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
				state: "ongoing",
				size: 12
			}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "meshy-dot",
				"data-on": pill === "on" || void 0,
				"data-warn": pill === "warn" || void 0
			}), t(pill === "checking" ? "checking" : pill === "on" ? "signedIn" : pill === "warn" ? "unverified" : "signedOut")]
		})]
	});
}
function Skeleton() {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "meshy-card meshy-rows",
		"aria-hidden": "true",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "meshy-row",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "meshy-skeleton",
					style: {
						width: 64,
						height: 14
					}
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "meshy-skeleton",
					style: {
						width: 120,
						height: 22
					}
				})]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "meshy-divider" }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "meshy-row",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "meshy-skeleton",
					style: {
						width: 48,
						height: 14
					}
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "meshy-skeleton",
					style: {
						width: 180,
						height: 36
					}
				})]
			})
		]
	});
}
function Alert({ children, action }) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "meshy-alert",
		role: "alert",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, { size: 14 }),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "meshy-copy",
				style: { flex: 1 },
				children
			}),
			action
		]
	});
}
function MeshyPanel({ t, view }) {
	const [status, setStatus] = (0, react.useState)();
	const site = useSite();
	const [flow, setFlow] = (0, react.useState)();
	const [busy, setBusy] = (0, react.useState)(false);
	const [problem, setProblem] = (0, react.useState)();
	const [copied, setCopied] = (0, react.useState)(false);
	const [confirmOut, setConfirmOut] = (0, react.useState)(false);
	const polling = (0, react.useRef)(0);
	(0, react.useEffect)(() => {
		if (status?.auth?.authenticated) setSite(status.auth.region);
	}, [status]);
	const refresh = (0, react.useCallback)(async () => {
		setStatus(void 0);
		setProblem(void 0);
		try {
			const next = (await api("meshy.status")).data;
			setStatus(next);
			if (!next.cli) setProblem({ kind: "cli" });
		} catch (err) {
			setStatus({ cli: null });
			setProblem({
				kind: "generic",
				message: String(err)
			});
		}
	}, []);
	(0, react.useEffect)(() => {
		if (view !== "summary") refresh();
		return () => {
			polling.current++;
		};
	}, [refresh, view]);
	if (view === "summary") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("summary") });
	const signIn = async () => {
		setBusy(true);
		setProblem(void 0);
		try {
			const { status: code, data } = await api("meshy.login", { region: site });
			if (code !== 200) throw new Error(data.error ?? String(code));
			setFlow(data);
			const run = ++polling.current;
			const deadline = Date.now() + (data.expires_in ?? 600) * 1e3;
			while (run === polling.current) {
				if (Date.now() > deadline) {
					setFlow(void 0);
					setProblem({ kind: "expired" });
					return;
				}
				const done = await api("meshy.login.finish", { flow_id: data.flow_id });
				if (run !== polling.current) return;
				if (done.status === 202) continue;
				if (done.status !== 200) {
					setFlow(void 0);
					setProblem(/expir/i.test(done.data.error ?? "") ? { kind: "expired" } : {
						kind: "generic",
						message: done.data.error ?? String(done.status)
					});
					return;
				}
				setFlow(void 0);
				await refresh();
				return;
			}
		} catch (err) {
			setFlow(void 0);
			setProblem({
				kind: "generic",
				message: String(err?.message ?? err)
			});
		} finally {
			setBusy(false);
		}
	};
	const cancel = () => {
		polling.current++;
		setFlow(void 0);
		setBusy(false);
	};
	const signOut = async () => {
		setConfirmOut(false);
		setBusy(true);
		try {
			const { status: code, data } = await api("meshy.logout", {});
			if (code !== 200) throw new Error(data.error ?? String(code));
			await refresh();
		} catch (err) {
			setProblem({
				kind: "generic",
				message: String(err?.message ?? err)
			});
		} finally {
			setBusy(false);
		}
	};
	const copy = async () => {
		if (flow && await (0, _deepseek_ai_dsh_client_ui_primitives.writeClipboard)(flow.user_code)) {
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		}
	};
	const auth = status?.auth;
	const signedIn = !!auth?.authenticated;
	const shownSite = auth?.region ?? site;
	const problemText = problem && (problem.kind === "expired" ? t("error.expired") : problem.kind === "cli" ? t("error.cli") : t("error.generic", { message: problem.message ?? "" }));
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
		className: "meshy-root meshy-section",
		"aria-label": t("nav"),
		children: [!status ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Identity, {
			t,
			page: view === "page",
			line: t(view === "page" ? "summary" : "tagline"),
			pill: "checking"
		}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Skeleton, {})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Identity, {
				t,
				page: view === "page",
				line: signedIn ? `${t(`site.${shownSite}`)} · ${SITES[shownSite].host}` : t(view === "page" ? "summary" : "tagline"),
				pill: !status.cli ? "off" : !signedIn ? "off" : auth.verified ? "on" : "warn"
			}),
			problem && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Alert, {
				action: problem.kind === "cli" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					size: "sm",
					onClick: refresh,
					children: t("refresh")
				}) : problem.kind === "expired" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
					variant: "outline",
					size: "sm",
					onClick: signIn,
					children: t("retry")
				}) : void 0,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: problemText }), problem.kind === "cli" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "meshy-muted meshy-small",
					children: t("error.cliHint")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: "npm install -g meshy-cli@0.7" })] })]
			}),
			status.cli && signedIn && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "meshy-card meshy-rows",
				children: [
					!auth.verified && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Alert, { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("unverified.hint") }) }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "meshy-row",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("credits") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "meshy-amount",
							children: auth.balance === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "meshy-muted meshy-small",
								children: "—"
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "meshy-coin" }), auth.balance.toLocaleString()] })
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "meshy-divider" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "meshy-row",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("account") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "meshy-muted",
							children: auth.credential ?? auth.source ?? "—"
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "meshy-divider" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "meshy-row",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "meshy-muted",
							children: t("more")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "meshy-actions",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "outline",
								disabled: busy,
								onClick: () => setConfirmOut(true),
								children: t("signOut")
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("a", {
								className: "meshy-link meshy-accent",
								href: `${SITES[shownSite].web}/pricing`,
								target: "_blank",
								rel: "noreferrer",
								children: [t("credits.get"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRightUpOutlineRegular, { size: 12 })]
							})]
						})]
					})
				]
			}),
			status.cli && !signedIn && !flow && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "meshy-card meshy-rows",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "meshy-row",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("site") }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.SegmentedControl, {
							id: "meshy-site",
							label: t("site"),
							value: site,
							disabled: busy,
							onChange: (value) => setSite(value),
							options: [{
								value: "global",
								label: `${t("site.global")} · meshy.ai`
							}, {
								value: "cn",
								label: `${t("site.cn")} · meshy.cn`
							}]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { className: "meshy-divider" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "meshy-row",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "meshy-muted",
							children: t("signIn.hint")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "primary",
							className: "meshy-accent",
							disabled: busy,
							onClick: signIn,
							children: t("signIn")
						})]
					})
				]
			}),
			flow && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "meshy-card meshy-signin",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", {
					className: "meshy-qr",
					src: qr(flow.verification_url),
					alt: ""
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "meshy-copy",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "meshy-name",
							children: t("signIn.scan")
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "meshy-muted",
							children: t("signIn.scanHint", { host: SITES[site].host })
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "meshy-code",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "meshy-muted",
									children: t("signIn.code")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: flow.user_code }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
									label: copied ? t("copied") : t("copy"),
									side: "top",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
										variant: "ghost",
										size: "sm",
										"aria-label": t("copy"),
										icon: copied ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutlineRegular, { size: 14 }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCopyOutlineRegular, { size: 14 }),
										onClick: copy
									})
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "meshy-waiting",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.StateDot, {
								state: "ongoing",
								size: 12
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.TextShimmer, {
								active: true,
								children: t("signIn.waiting")
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "meshy-actions",
							style: { justifyContent: "flex-start" },
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("a", {
								className: "meshy-link meshy-accent",
								href: flow.verification_url,
								target: "_blank",
								rel: "noreferrer",
								children: [t("signIn.open"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRightUpOutlineRegular, { size: 12 })]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
								variant: "outline",
								onClick: cancel,
								children: t("cancel")
							})]
						})
					]
				})]
			}),
			status.cli && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "meshy-foot meshy-muted meshy-small",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [t("cli", { version: status.cli.version }), status.cli.runner === "npm exec" ? ` · ${t("cli.temporary")}` : ""] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
					label: t("refresh"),
					side: "top",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
						variant: "ghost",
						size: "sm",
						"aria-label": t("refresh"),
						disabled: busy,
						icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 14 }),
						onClick: refresh
					})
				})]
			})
		] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
			open: confirmOut,
			onClose: () => setConfirmOut(false),
			title: t("signOut.title"),
			closeLabel: t("close"),
			description: t("signOut.body"),
			footer: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				onClick: () => setConfirmOut(false),
				children: t("cancel")
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "primary",
				onClick: signOut,
				children: t("signOut")
			})] })
		})]
	});
}
/** Set while the workspace navigation service is mounted: opens a new session with the prompt filled in. */
let startSession;
/** Left-sidebar icon: the host passes the edge size (18 expanded, 16 collapsed); colour follows the row. */
function MeshySidebarIcon({ size = 16 }) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
		className: "meshy-mark",
		"aria-hidden": "true",
		style: {
			width: size,
			height: size
		},
		dangerouslySetInnerHTML: { __html: "<svg fill=\"currentColor\" fill-rule=\"evenodd\" height=\"100%\" style=\"flex:none;line-height:1\" viewBox=\"0 0 24 24\" width=\"100%\" xmlns=\"http://www.w3.org/2000/svg\"><title>Meshy</title><path d=\"M3.214.358l.59 1.606 1.597.595-1.596.594-.59 1.607-.591-1.607-1.596-.594 1.596-.595.59-1.606zM16.3 1.691a8.04 8.04 0 012.178.641c6.94 2.96 6.273 11.893.308 11.306l-.008-.007c.09.247.177.51.25.779.803 2.395-2.534 3.633-4.663 3.785l.138-.078c2.107-1.3 2.17-6.033-.175-5.56-.855.303-1.641 1.093-2 2.503a6.199 6.199 0 00-.093.436 25.87 25.87 0 00-.102.614c-.147.94-.32 2.038-.821 2.66-.578.041-1.153.043-1.711.001.737-.577 1.098-1.385 1.377-2.584-3.215.395-6.084-.384-6.257-4.094.17.809.509 1.431.972 1.896.267.133.61.252 1.043.345.911.196 1.928.07 2.646-.116.36.237.648.518.823.843.23-.027.464-.061.7-.102a4.523 4.523 0 00-.01-.197 3.115 3.115 0 01-.06-.209c-.108-.395-.278-1.023-.953-1.476-.391-.261-.76-.609-.696-1.075.064-.459.478-.731.93-.84 2.84-.683 4.568-2.988 5.45-5.648C14.988 6.75 14.129 8 13.032 8.947c-2.062 1.781-5.857 1.971-7.106.487.364.217.776.359 1.219.431-.299-.122-.54-.291-.665-.52 3.221.894 6.802-2.252 8.148-6.784-2.963-.128-6.335 1.44-8.25 4.01 2.084-3.387 6.04-5.44 9.916-4.88h.007zm2.57 5.476c-.357 1.21-.224 2.564.444 3.459.058.078.121.154.188.225l-.89.809c-1.327-.571-1.541-2.22-.99-3.741a5.04 5.04 0 011.32-1.997 3.822 3.822 0 011.195-.747l.003.004a3.511 3.511 0 00-.559.574c-.322.415-.56.902-.711 1.414z\"></path><path d=\"M20.352 14.028c6.788 3.227-.077 9.51-10.095 8.441-.36-.033-.72-.08-1.077-.142 3.05-.146 5.386-.591 7.887-2.766-5.111 3.23-14.152 2.117-12.294-1.535-.236 3.143 10.482 2.832 15.062-1.501-.73 2.168-1.945 3.664-3.423 4.62 3.978-1.476 6.496-4.16 3.94-7.117zM7.742 8.427s.236.142.573-.039c.546-.292.673-2.054.673-3.083 0-.278-.342-.283-.342-.283l-.029.003c-.398.042-.704.264-.682.495.079.862-.071 1.94-.27 2.64-.028.1.003.192.077.267zM11.395 6.972c-.338.181-.573.039-.573.039a.263.263 0 01-.078-.267c.2-.7.349-1.778.27-2.64-.021-.231.285-.453.683-.495.01 0 .019-.002.028-.003 0 0 .343.005.343.283 0 1.029-.128 2.79-.673 3.083zM1.056 5.438l-.337-.922-.337.922-.91.341.91.341.337.923.337-.923.91-.34-.91-.342z\"></path></svg>" }
	});
}
function ExampleCard({ t, id }) {
	const prompt = t(`example.${id}.prompt`);
	const [copied, setCopied] = (0, react.useState)(false);
	const run = async () => {
		if (startSession) return startSession(prompt);
		if (await (0, _deepseek_ai_dsh_client_ui_primitives.writeClipboard)(prompt)) {
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		}
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
		type: "button",
		className: "meshy-example",
		onClick: run,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "meshy-example-title",
				children: t(`example.${id}.title`)
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "meshy-muted",
				children: prompt
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "meshy-example-cta",
				children: startSession ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [t("page.try"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutlineRegular, { size: 12 })] }) : copied ? t("copied") : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [t("copy"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCopyOutlineRegular, { size: 12 })] })
			})
		]
	});
}
/** The page the sidebar entry opens in the main column: the account card plus ways to start. */
function MeshyPage({ t }) {
	const site = useSite();
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
		className: "meshy-root meshy-page",
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: "meshy-page-inner",
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
					className: "meshy-hero",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Logo, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "meshy-copy",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", { children: "Meshy" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "meshy-muted",
							children: t("page.tagline")
						})]
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(MeshyPanel, {
					t,
					view: "page"
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					className: "meshy-block",
					"aria-labelledby": "meshy-start",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "meshy-copy",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
							id: "meshy-start",
							className: "meshy-h2",
							children: t("page.start")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "meshy-muted",
							children: t(startSession ? "page.startHint" : "page.copyHint")
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "meshy-grid",
						children: EXAMPLES.map((id) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ExampleCard, {
							t,
							id
						}, id))
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("footer", {
					className: "meshy-links meshy-small",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("a", {
						className: "meshy-textlink",
						href: docsUrl(site),
						target: "_blank",
						rel: "noreferrer",
						children: [t("page.docs"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRightUpOutlineRegular, { size: 12 })]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("a", {
						className: "meshy-textlink",
						href: SITES[site].web,
						target: "_blank",
						rel: "noreferrer",
						children: [t("page.site"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRightUpOutlineRegular, { size: 12 })]
					})]
				})
			]
		})
	});
}
/** The keyed `sidebar.right.tab.document` body for .glb, fed the file's complete bytes. */
function GlbBody({ content, t }) {
	const host = (0, react.useRef)(null);
	const [viewer, setViewer] = (0, react.useState)();
	const [error, setError] = (0, react.useState)();
	const [spinning, setSpinning] = (0, react.useState)(false);
	(0, react.useEffect)(() => {
		const el = host.current;
		if (content.kind !== "bytes" || !content.data || !el) return;
		let mounted;
		let cancelled = false;
		setError(void 0);
		setViewer(void 0);
		setSpinning(false);
		require.async("./client.viewer.js").then((module) => module.mountViewer(el, content.data)).then((v) => {
			if (cancelled) v.dispose();
			else {
				mounted = v;
				setViewer(v);
			}
		}).catch((err) => {
			if (!cancelled) setError(String(err?.message ?? err));
		});
		return () => {
			cancelled = true;
			mounted?.dispose();
		};
	}, [content]);
	const toggle = () => {
		viewer?.setAutoRotate(!spinning);
		setSpinning(!spinning);
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: "meshy-root meshy-viewer",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				ref: host,
				className: "meshy-stage"
			}),
			!viewer && !error && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "meshy-overlay meshy-muted",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Logo, {}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.TextShimmer, {
					active: true,
					children: t("viewer.loading")
				})]
			}),
			error && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "meshy-overlay",
				role: "alert",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconWarningOutlineRegular, { size: 20 }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("viewer.failed") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "meshy-muted meshy-small",
						children: error
					})
				]
			}),
			viewer && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "meshy-bar",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "meshy-chip",
					children: [content.data ? `${(0, _deepseek_ai_dsh_client_ui_primitives.fileSizeText)(content.data.byteLength)} · ` : "", t("viewer.triangles", { count: viewer.triangles.toLocaleString() })]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "meshy-tools",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
						label: t("viewer.reset"),
						side: "top",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "ghost",
							size: "sm",
							"aria-label": t("viewer.reset"),
							icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutlineRegular, { size: 14 }),
							onClick: () => viewer.reset()
						})
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
						label: spinning ? t("viewer.stop") : t("viewer.spin"),
						side: "top",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
							variant: "ghost",
							size: "sm",
							"aria-label": spinning ? t("viewer.stop") : t("viewer.spin"),
							"aria-pressed": spinning,
							icon: spinning ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPauseOutlineRegular, { size: 14 }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlayOutlineRegular, { size: 14 }),
							onClick: toggle
						})
					})]
				})]
			})
		]
	});
}
function apply(ctx) {
	ctx.effect(() => ctx.locale.register(NS, {
		zh,
		en
	}), "meshy-dsh: dictionaries");
	ctx.effect(() => ctx.slots.inject("settings.section", () => ctx.slots.register({
		name: "settings.section",
		id: "meshy",
		order: 40,
		label: () => ctx.locale.bind(NS)("nav"),
		locale: NS
	}, MeshyPanel)), "meshy-dsh: settings section");
	ctx.effect(() => ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register({
		name: "plugins.bundle.config",
		key: "meshy-dsh",
		locale: NS
	}, MeshyPanel)), "meshy-dsh: bundle page");
	ctx.inject([
		"layout",
		"slots",
		"locale"
	], (ctx) => {
		ctx.effect(() => ctx.slots.inject("main", () => ctx.slots.register({
			name: "main",
			key: PAGE_ID,
			locale: NS
		}, MeshyPage)), "meshy-dsh: page");
		ctx.effect(() => ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
			name: "sidebar.panellist",
			id: PAGE_ID,
			order: 20,
			label: "Meshy"
		}, MeshySidebarIcon)), "meshy-dsh: sidebar entry");
	});
	ctx.inject(["uiWorkspace"], (ctx) => {
		ctx.effect(() => {
			startSession = (prompt) => ctx.uiWorkspace.startSession(void 0, {
				prompt,
				whenDraftExists: "replace"
			});
			return () => {
				startSession = void 0;
			};
		}, "meshy-dsh: start a session from an example");
	});
	ctx.inject([
		"documentPreviews",
		"slots",
		"locale"
	], (ctx) => {
		ctx.effect(() => ctx.documentPreviews.register({
			id: GLB_ID,
			extensions: ["glb"],
			binaryExtensions: ["glb"],
			priority: "extension",
			title: () => ctx.locale.bind(NS)("viewer.title"),
			loading: "bytes-complete"
		}), "meshy-dsh: glb preview");
		ctx.effect(() => ctx.slots.inject("sidebar.right.tab.document", () => ctx.slots.register({
			name: "sidebar.right.tab.document",
			key: GLB_ID,
			locale: NS
		}, GlbBody)), "meshy-dsh: glb body");
	});
}

exports.apply = apply;
exports.inject = inject;
exports.name = name;
return module.exports; } });