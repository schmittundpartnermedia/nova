#!/usr/bin/env swift
import AppKit
import Foundation

let black = NSColor.black
let ink = NSColor(calibratedWhite: 0.08, alpha: 1)
let paper = NSColor.white
let mist = NSColor(calibratedWhite: 0.78, alpha: 1)

enum Mark {
    case wordmark
    case letter
    case orb
}

func mark(for pixels: Int) -> Mark {
    if pixels >= 96 { return .wordmark }
    if pixels >= 28 { return .letter }
    return .orb
}

func render(pixels: Int) -> NSBitmapImageRep {
    let size = CGFloat(pixels)
    let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: pixels,
        pixelsHigh: pixels,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .calibratedRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    )!
    rep.size = NSSize(width: size, height: size)
    NSGraphicsContext.saveGraphicsState()
    let context = NSGraphicsContext(bitmapImageRep: rep)!
    context.shouldAntialias = true
    context.imageInterpolation = .high
    NSGraphicsContext.current = context
    let ctx = context.cgContext
    let rect = CGRect(x: 0, y: 0, width: size, height: size)

    ctx.setFillColor(black.cgColor)
    ctx.fill(rect)

    let background = CGGradient(
        colorsSpace: CGColorSpaceCreateDeviceGray(),
        colors: [ink.cgColor, black.cgColor] as CFArray,
        locations: [0, 1]
    )!
    ctx.drawLinearGradient(
        background,
        start: CGPoint(x: size * 0.5, y: size),
        end: CGPoint(x: size * 0.5, y: 0),
        options: []
    )

    drawGlow(ctx: ctx, size: size)
    drawSheen(ctx: ctx, size: size)

    switch mark(for: pixels) {
    case .wordmark:
        drawWord(ctx: ctx, size: size, text: "NOVA", fontSize: size * 0.22, accent: true)
    case .letter:
        drawWord(ctx: ctx, size: size, text: "N", fontSize: size * 0.58, accent: false)
    case .orb:
        drawCore(ctx: ctx, size: size)
    }

    NSGraphicsContext.restoreGraphicsState()
    return rep
}

func drawGlow(ctx: CGContext, size: CGFloat) {
    let center = CGPoint(x: size * 0.5, y: size * 0.58)
    let glow = CGGradient(
        colorsSpace: CGColorSpaceCreateDeviceGray(),
        colors: [
            paper.withAlphaComponent(0.38).cgColor,
            mist.withAlphaComponent(0.14).cgColor,
            black.withAlphaComponent(0).cgColor,
        ] as CFArray,
        locations: [0, 0.38, 1]
    )!
    ctx.drawRadialGradient(
        glow,
        startCenter: center,
        startRadius: 0,
        endCenter: center,
        endRadius: size * 0.46,
        options: []
    )
}

func drawSheen(ctx: CGContext, size: CGFloat) {
    let sheen = CGGradient(
        colorsSpace: CGColorSpaceCreateDeviceGray(),
        colors: [
            paper.withAlphaComponent(0.14).cgColor,
            paper.withAlphaComponent(0).cgColor,
        ] as CFArray,
        locations: [0, 1]
    )!
    ctx.drawLinearGradient(
        sheen,
        start: CGPoint(x: 0, y: size),
        end: CGPoint(x: 0, y: size * 0.58),
        options: []
    )
}

func drawCore(ctx: CGContext, size: CGFloat) {
    let inset = size * 0.22
    let rect = CGRect(x: inset, y: inset, width: size - inset * 2, height: size - inset * 2)
    let core = CGGradient(
        colorsSpace: CGColorSpaceCreateDeviceGray(),
        colors: [paper.cgColor, mist.cgColor, NSColor(calibratedWhite: 0.22, alpha: 1).cgColor] as CFArray,
        locations: [0, 0.45, 1]
    )!
    ctx.saveGState()
    ctx.addEllipse(in: rect)
    ctx.clip()
    ctx.drawRadialGradient(
        core,
        startCenter: CGPoint(x: size * 0.4, y: size * 0.66),
        startRadius: 0,
        endCenter: CGPoint(x: size * 0.5, y: size * 0.5),
        endRadius: size * 0.34,
        options: []
    )
    ctx.restoreGState()
}

func drawWord(ctx: CGContext, size: CGFloat, text: String, fontSize: CGFloat, accent: Bool) {
    let font = NSFont.systemFont(ofSize: fontSize, weight: .semibold)
    let attributes: [NSAttributedString.Key: Any] = [
        .font: font,
        .foregroundColor: paper,
        .kern: fontSize * (text.count > 1 ? 0.12 : 0),
    ]
    let attributed = NSAttributedString(string: text, attributes: attributes)
    let textSize = attributed.size()
    let flipped = NSGraphicsContext.current?.isFlipped ?? false
    let origin = CGPoint(
        x: (size - textSize.width) / 2,
        y: (size - textSize.height) / 2 + size * 0.02
    )
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: flipped ? size * 0.012 : -size * 0.012), blur: size * 0.06, color: paper.withAlphaComponent(0.45).cgColor)
    attributed.draw(at: origin)
    ctx.restoreGState()
    attributed.draw(at: origin)

    guard accent else { return }
    let barWidth = textSize.width * 0.38
    let barHeight = max(2, size * 0.012)
    let gap = size * 0.045
    let barY = flipped ? origin.y + textSize.height + gap : origin.y - gap - barHeight
    paper.setFill()
    NSRect(x: (size - barWidth) / 2, y: barY, width: barWidth, height: barHeight).fill()
}

func writePng(_ rep: NSBitmapImageRep, to url: URL) throws {
    guard let data = rep.representation(using: .png, properties: [:]) else {
        throw NSError(domain: "NOVAIcon", code: 1, userInfo: [NSLocalizedDescriptionKey: "PNG konnte nicht erzeugt werden."])
    }
    try data.write(to: url)
}

let iconset = URL(fileURLWithPath: CommandLine.arguments.dropFirst().first ?? "", isDirectory: true)
if iconset.path.isEmpty {
    fputs("usage: generate-app-icon.swift <iconset-dir>\n", stderr)
    exit(2)
}

try FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)

let specs: [(String, Int)] = [
    ("icon_16x16.png", 16),
    ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32),
    ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128),
    ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256),
    ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512),
    ("icon_512x512@2x.png", 1024),
]

for (name, pixels) in specs {
    try writePng(render(pixels: pixels), to: iconset.appendingPathComponent(name))
}

print(iconset.appendingPathComponent("icon_512x512@2x.png").path)
