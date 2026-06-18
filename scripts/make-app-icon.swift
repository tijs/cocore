// Render the cocore app icon (Finder/Spotlight/dock) to a 1024px PNG.
//
// Geometry mirrors packages/console/public/app-icon.svg: a #111110
// rounded-square background (corner radius 230 at 1024) with the tan
// (#ad7f58) "receipt notch" mark centered at 5x scale (the SVG applies
// translate(262,262) scale(5) to the 0..100 favicon path). Drawn with
// NSBezierPath so there's no dependency on rsvg/ImageMagick.
//
// Usage: swift scripts/make-app-icon.swift <out.png>   (default icon_master.png)

import AppKit

let outPath = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "icon_master.png"
let S: CGFloat = 1024

let image = NSImage(size: NSSize(width: S, height: S), flipped: false) { _ in
    guard let ctx = NSGraphicsContext.current?.cgContext else { return false }

    // Background: #111110, rounded rect (rx = 230 at 1024).
    let bg = NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: S, height: S),
                          xRadius: 230, yRadius: 230)
    NSColor(red: 0x11 / 255.0, green: 0x11 / 255.0, blue: 0x10 / 255.0, alpha: 1).setFill()
    bg.fill()

    // Mark: place the 0..100 path at SVG offset (262,262) scaled 5x, i.e.
    // a centered 500x500 glyph. SVG is y-down; AppKit (flipped:false) is
    // y-up, so translate to (262, S-262) and scale y by -5.
    ctx.translateBy(x: 262, y: S - 262)
    ctx.scaleBy(x: 5.0, y: -5.0)

    let path = NSBezierPath()
    path.windingRule = .evenOdd
    path.move(to: NSPoint(x: 0, y: 0)); path.line(to: NSPoint(x: 100, y: 0))
    path.line(to: NSPoint(x: 100, y: 70)); path.line(to: NSPoint(x: 70, y: 100))
    path.line(to: NSPoint(x: 0, y: 100)); path.close()
    path.move(to: NSPoint(x: 22, y: 22)); path.line(to: NSPoint(x: 22, y: 78))
    path.line(to: NSPoint(x: 55.6, y: 78)); path.line(to: NSPoint(x: 78, y: 55.6))
    path.line(to: NSPoint(x: 78, y: 22)); path.close()
    NSColor(red: 0xad / 255.0, green: 0x7f / 255.0, blue: 0x58 / 255.0, alpha: 1).setFill()
    path.fill()
    return true
}

guard let tiff = image.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff),
      let png = rep.representation(using: .png, properties: [:]) else {
    FileHandle.standardError.write(Data("icon render failed\n".utf8))
    exit(1)
}
try! png.write(to: URL(fileURLWithPath: outPath))
print("wrote \(outPath)")
