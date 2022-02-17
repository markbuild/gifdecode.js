/*!
 * gifdecode.js v1.0.0
 * https://github.com/markbuild/gifdecode.js
 * Copyright 2017, Mark Li
 * Licence: Unlicense <http://unlicense.org>
 * 
 * Comment by KaygNas
 * 根据文章书写对应的注释，建议阅读原文再看解码的代码更有助于理解
 * https://markbuild.com/zh/javascript%E8%A7%A3%E7%A0%81gif%E5%8A%A8%E7%94%BB%E4%BA%8C%E8%BF%9B%E5%88%B6/
 */
function GifFile(_buffer) {
	this.decArray = new Uint8Array(_buffer)
	// 所有GIF文件必须以Header 区块开头，它占用6个bytes，这些字节都对应于ASCII码.
	// 第0/1/2个字节称为signature(签名)。它应该一直是”GIF” (ie 47=”G”, 49=”I”, 46=”F”)。
	this.signature =
		String.fromCharCode(this.decArray[0]) +
		String.fromCharCode(this.decArray[1]) +
		String.fromCharCode(this.decArray[2]) // Should always be "GIF"
	// 第3/4/5个字节指定编码(encode)图像的规范版本。 我们只会使用“89a”（即38 =“8”，39 =“9”，61 =“a”）。
	this.version =
		String.fromCharCode(this.decArray[3]) +
		String.fromCharCode(this.decArray[4]) +
		String.fromCharCode(this.decArray[5]) //89a or 87a
	this.init()
}

GifFile.prototype.init = function () {
	// Logical Screen Descriptor 区块
	// 第6、7个字节代表画布宽，低位字节排放在内存的低地址端，高位字节排放在内存的高地址端
	// 因而若第一个字节值为 XY 转换为十进制 XY = X * 16^1 + Y * 16^0 = (X * 16 + Y) * 16^0
	// 若第二个字节值为 XY 转换为十进制 XY = X * 16^3 + Y * 16^2 = (X * 16 + Y) * 16^2
	// this.decArray[6] 和 this.decArray[7] 已经转换成十进制
	this.canvasWidth = this.decArray[6] + this.decArray[7] * 256
	// 第8、9个字节代表画布高
	this.canvasHeight = this.decArray[8] + this.decArray[9] * 256
	// 第10个字节是一个packed字节，表示为二进制数
	// 第1个比特(bit)是全局颜色表flag.如果值是0,后面就没有颜色表，如果是1就有颜色表。
	// 接下来三位表示颜色分辨率， 001表示 2 bits/pixel; 111 表示8 bits/pixel。
	// 后一位是排序标识，如果值为1，那么颜色在全局颜色表中以”decreasing importance”来排序
	// 最后三位是全局颜色表的大小，它的值是2^(1+n), n的最大值111(十进制7)，所以颜色表的数目范围是(2/4/8/16/32/64/128/256)
	// 第11个字节是背景颜色索引值，如果没有颜色表，这个值为0.
	// 当第5个字节 < 128 (即最大值为 0111 1111)
	if (this.decArray[10] < 128) {
		// No global color table
		// 全局颜色 flag = 0
		this.hasGlobalColorTable = false
		// 全局颜色表为 0，此时没有背景颜色索引值
		this.globalColorTableSize = 0
		this.backgroundColorIndex = 0
	} else {
		this.hasGlobalColorTable = true
		this.backgroundColorIndex = this.decArray[11]
		// this.decArray[10] % 8 = 最后三位是全局颜色表的大小的 n 值
		this.globalColorTableSize = Math.pow(2, (this.decArray[10] % 8) + 1)
	}
	// 第12个字节是像素纵横比
	// index 为图形控制扩展块的第一个字节索引
	var index = 13 + this.globalColorTableSize * 3 /** 颜色表的字节数 */

	var trailer = false
	this.frames = []
	this.structureBlocks = []
	this.globalColorTable = this.getGlobalColorTable()
	var delayTime = 0
	var transparentColorIndex = null
	var transparentColorFlag = 0
	var disposalMethod = 2
	var previousDisposalMethod = 2
	var pixelColors = []
	var previousPixelColors

	do {
		// Image Descriptor 区块, 每个图像描述符以0x2C(十进制44)开头
		if (this.decArray[index] == 44) {
			//Image Descriptor
			this.structureBlocks.push(44)
			// 接下来8个字节表示图像位置和尺寸
			var imageLeft = this.decArray[index + 1] + this.decArray[index + 2] * 256
			var imageTop = this.decArray[index + 3] + this.decArray[index + 4] * 256
			var imageWidth = this.decArray[index + 5] + this.decArray[index + 6] * 256
			var imageHeight = this.decArray[index + 7] + this.decArray[index + 8] * 256
			// 第9个字节也是一个packed field.第一位是局部颜色表.如果设置为1允许你指定局部颜色表
			var colorTable /** 颜色表，有局部颜色表则使用局部，否则使用全局 */
			if (this.decArray[index + 9] < 128) {
				// No local color table
				var localColorTable = []
				colorTable = this.globalColorTable.concat()
				// 完成 Image Descriptor 区块处理
				index += 10
			} else {
				this.structureBlocks.push(45)
				var localColorTableSize = Math.pow(2, (this.decArray[index + 9] % 8) + 1)
				var localColorTable = this.getLocalColorTable(index + 10, localColorTableSize).concat()
				colorTable = localColorTable
				// 完成 Image Descriptor 区块处理
				index += localColorTableSize * 3 + 10
			}
			// 透明颜色 flag 在处理图形控制扩展块是获得赋值
			if (transparentColorFlag) {
				// GIF没有半透明,如果一个图像的颜色索引是255,颜色表中索引255的颜色值是rgb(255,255,255),
				// 那么Image Data中存储255索引的像素最终在图像上的值就是rgba(255,255,255,0);
				colorTable[transparentColorIndex] = colorTable[transparentColorIndex]
					.replace('rgb', 'rgba')
					.replace(')', ',0)')
			}

			//Image data block
			this.structureBlocks.push(46)
			// GIF是会压缩图像的索引，使用的是GIF版的LZW压缩
			// 第一个字节是 lzwMinCodeSize
			var lzwMiniCodeSize = this.decArray[index]
			index++
			var byteStream = []

			do {
				// 接下来的均为数据子块
				// 数据字块的第一个字节为子块的字节数
				var subBlockSize = this.decArray[index]
				if (subBlockSize == undefined) {
					return
				}
				for (var i = 1; i <= subBlockSize; i++) {
					byteStream.push(this.decArray[index + i])
				}
				// 处理完一个数据子块，跳至下一个子块
				index += subBlockSize + 1
			} while (this.decArray[index] != 0) // Block Terminator is 0x00, 图像数据块的结束标识是 0
			// 收集所有的数据子块后进行 lzw 解码，返回图像的索引流
			var indexStream = this.lzwDecode(byteStream, lzwMiniCodeSize)

			// 将每个像素的索引流转换为对应的颜色表的 rgba 值
			for (var h = 0; h < imageHeight; h++) {
				for (var w = 0; w < imageWidth; w++) {
					// 像素若不存在的索引值使用背景颜色的索引值
					if (!indexStream[h * imageWidth + w]) {
						indexStream[h * imageWidth + w] = this.backgroundColorIndex
					}

					if (
						// 如果索引值是透明像素，而且处置方法值 != 2（代表画布应该恢复为背景颜色）
						// 则跳过设置像素颜色
						colorTable[indexStream[h * imageWidth + w]].indexOf('rgba') >= 0 &&
						previousDisposalMethod != 2
					) {
						continue
					}
					// 设置对应像素的 rgba 值(注意每帧可能会有 top 和 left 的偏移，并非占满画布)
					pixelColors[(imageTop + h) * this.canvasWidth + imageLeft + w] =
						colorTable[indexStream[h * imageWidth + w]]
				}
			}

			// 此时完成一帧的所有像素索引值转换对应颜色
			this.frames.push({ pixelColors: pixelColors.concat(), delayTime: delayTime })
			switch (disposalMethod) {
				case 0: // This image were not animated
					break
				case 1: // Leave the image in place and draw the next image on top of it
					break
				case 2: // The canvas should be restored to the background color
					pixelColors = []
					break
				case 3: // Restore the canvas to its previous state before the current image was drawn
					pixelColors = previousPixelColors
					break
			}
			previousPixelColors = pixelColors.concat()
			previousDisposalMethod = disposalMethod
			index++
		}
		// Trailer block预示着文件末尾,它是值总是3B
		// 遇到 Trailer 即可结束解码
		else if (this.decArray[index] == 59) {
			//0x3B
			trailer = true
		}
		// 处理拓展块
		// 第1个字节是扩展引导器，所有扩展块以21(十六进制即十进制的33)开头。
		else {
			// 此时 index 值为第1个字节的扩展引导器 21
			// 第2个字节为拓展其的类型
			this.extensionType = this.decArray[index + 1]
			this.structureBlocks.push(this.extensionType)
			switch (this.extensionType) {
				// Graphics Control Extension, 经常用于指定透明度设置和控制动画
				// 图形控制拓展标签值F9(十进制249)
				case 249:
					// 第3个字节是Byte Size，它的值总是4.
					// index + 3 是第4个字节的 packed field, Bit 8是透明颜色标志
					transparentColorFlag = this.decArray[index + 3] % 2
					// Bits 4-6 表示处置方法
					disposalMethod = (this.decArray[index + 3] >> 2) % 8
					// 第5，6个字节是延迟时间值，实际时间为此值乘以0.01s
					delayTime = (this.decArray[index + 4] + this.decArray[index + 5] * 256) * 0.01
					// 第7个字节是透明颜色索引
					transparentColorIndex = this.decArray[index + 6]
					// 完成图形控制扩展块处理
					index += 8
					break

				// Application Extension, 应用程序拓展，允许将应用程序特定信息嵌入到GIF文件本身中
				// 应用程序拓展标签值为FF(十进制255)
				case 255:
					// 第3个字节 0B 代表后面有一个11个字节长的固定数据
					index += this.decArray[index + 3 + 11] + 11
					do {
						var subBlockSize = this.decArray[index]
						// 跳过应用拓展的数据子块处理
						index += subBlockSize + 1
					} while (this.decArray[index] != 0)
					index++
					break

				// Comment Extension, 注释拓展
				// 注释拓展的标签值为FE(二进制254)
				case 254:
					index += 2
					do {
						var subBlockSize = this.decArray[index]
						if (subBlockSize == 0) {
							return
						}
						// 跳过应用拓展的数据子块处理
						index += subBlockSize + 1
					} while (this.decArray[index] != 0)
					index++
					break
				case 1: // Plain Text Extension
					return
					break
			}
		}
	} while (!trailer)
}

GifFile.prototype.getGlobalColorTable = function () {
	// 从第 13 个字节开始为全局颜色表
	// 每种颜色都以3个字节(RGB)存储
	var colortable = []
	for (var i = 0; i < this.globalColorTableSize; i++) {
		colortable.push(
			'rgb(' +
				this.decArray[13 + i * 3 + 0] +
				',' +
				this.decArray[13 + i * 3 + 1] +
				',' +
				this.decArray[13 + i * 3 + 2] +
				')',
		)
	}
	return colortable
}

GifFile.prototype.getLocalColorTable = function (_index, _size) {
	var colortable = []
	for (var i = 0; i < _size; i++) {
		colortable.push(
			'rgb(' +
				this.decArray[_index + i * 3] +
				',' +
				this.decArray[_index + 1 + i * 3] +
				',' +
				this.decArray[_index + 2 + i * 3] +
				')',
		)
	}
	return colortable
}

/** lzw 解码，看不懂... */
GifFile.prototype.lzwDecode = function (_byteStream, _lzwMiniCodeSize) {
	var indexStream = []
	var byteindex = 0
	var bits = 0
	var bitStack = 0

	// GIF定义的最大编码号是#4095 (12-bit number 0xFFF)
	var MAX_CODE = 4095 // GIF format specifies a maximum code of #4095 (this happens to be the largest 12-bit number)
	var codeTable = []
	var codeBefore = -1
	var singleIndexCode = 0
	var code
	var codeStack = []
	// 有两个特殊编码(仅用于GIF版的LZW, 标准LZW压缩没有的)：clear code(CC)用来提示重新初始化编码表。
	// End Of Information Code(EOI)，提示已到达的图像的未尾了
	// 特殊编码紧跟颜色编码之后，实际上特殊编码的编码值取决于LZW最小编码长度.
	// 如果LZW最小编码长度与颜色表的大小相同,那么特殊编码会紧跟颜色编码后面;
	// 如果定义了一个较大的LZW最小编码长度值，特殊编码与最大颜色编码间会存在间隔
	var clearCode = 1 << _lzwMiniCodeSize
	var EOI = clearCode + 1
	var code_size = _lzwMiniCodeSize + 1
	var code_mask = (1 << code_size) - 1
	var nextAvailableCode = clearCode + 2
	var top = 0
	var code_tmp

	// 初始化编码表
	for (code = 0; code < clearCode; code++) {
		// Initialize the code table
		codeTable[code] = [0, code] // [codeBefore, singleIndexCode]
	}

	while (1) {
		if (bits < code_size) {
			bitStack += _byteStream[byteindex] << bits
			byteindex++
			bits += 8
			continue
		}
		// Get new code.
		code = bitStack & code_mask
		bitStack >>= code_size
		bits -= code_size
		// EOI Code
		if (code > nextAvailableCode || code == EOI) {
			break
		}
		// Clear Code
		if (code == clearCode) {
			code_size = _lzwMiniCodeSize + 1
			code_mask = (1 << code_size) - 1
			nextAvailableCode = clearCode + 2
			codeBefore = -1
			continue
		}
		if (codeBefore == -1) {
			codeStack[top++] = codeTable[code][1]
			codeBefore = code
			singleIndexCode = code
			continue
		}
		code_tmp = code
		if (code == nextAvailableCode) {
			code = codeBefore
			codeStack[top++] = singleIndexCode
		}
		while (code > clearCode) {
			codeStack[top++] = codeTable[code][1]
			code = codeTable[code][0]
		}
		singleIndexCode = codeTable[code][1] & 0xff // Max single index code is #255
		codeStack[top++] = singleIndexCode

		// Add a row for index buffer + K into code table
		if (nextAvailableCode <= MAX_CODE) {
			codeTable[nextAvailableCode] = [codeBefore, singleIndexCode] //?
			nextAvailableCode++
			if ((nextAvailableCode & code_mask) === 0 && nextAvailableCode <= MAX_CODE) {
				code_size++
				code_mask = (1 << code_size) - 1
			}
		}
		codeBefore = code_tmp
		while (top > 0) {
			top--
			indexStream.push(codeStack[top])
		}
	}

	return indexStream
}

GifFile.prototype.getExtensionTypeName = function (_e) {
	switch (_e) {
		case 249: //0xF9
			return "<span style='background:#CFCB9D'>Graphics Control Extension</span>"
			break
		case 255: //0xFF
			return "<span style='background:#CAC9A9'>Application Extension</span>"
			break
		case 254: //0xFE
			return "<span style='background:#CDCCAC'>Comment Extension</span>"
			break
		case 1: //0x01
			return "<span style='background:#B5B499'>Plain Text Extension</span>"
			break
		case 44: //0x2C
			return "<span style='background:#B9C7D1'>Image Descriptor</span>"
			break
		case 45:
			return "<span style='background:#DCDCDC'>Local Color Table</span>"
			break
		case 46:
			return "<span style='background:#BBB1B1'>Image Data</span><br>"
			break
	}
}
GifFile.prototype.getStructure = function () {
	var info =
		"<span style='background:#DDD08C'>Header</span> - <span style='background:#A5B3B2'>Logical Screen Descriptor</span>"
	info += this.hasGlobalColorTable
		? " - <span style='background:#D8D8D8'>Global Color Table</span><br>"
		: '<br>'
	for (var i in this.structureBlocks) {
		info += ' - ' + this.getExtensionTypeName(this.structureBlocks[i])
	}
	info += "- <span style='background:#F6E89B'>Trailer</span>"
	return info
}
