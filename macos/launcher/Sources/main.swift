import AppKit

let novaDelegate = AppDelegate()

autoreleasepool {
    let app = NSApplication.shared
    app.delegate = novaDelegate
    app.setActivationPolicy(.regular)
    app.run()
}
