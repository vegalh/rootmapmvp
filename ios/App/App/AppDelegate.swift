import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

// The app's web view (the window's root view controller, see SceneDelegate.swift; also set in Main.storyboard).
class RootMapViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        // Without the rubber-band bounce the page no longer stretches past its top and bottom edges while scrolling,
        // so the app frame stays put.
        webView?.scrollView.bounces = false
        // Swiping in from the left edge goes back a page, as in a navigation controller (each RootMap page is a
        // history entry; the web app follows it, see "Browser history" in App.tsx).
        webView?.allowsBackForwardNavigationGestures = true
        // A long press on an image or link doesn't open a web preview of it.
        webView?.allowsLinkPreview = false
        bridge?.registerPluginInstance(RootMapNativePlugin())
    }
}

// Native touches the web app asks for (src/lib/native.ts): haptic feedback, and the status bar and web view
// background following the app's light or dark theme.
@objc(RootMapNativePlugin)
public class RootMapNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RootMapNativePlugin"
    public let jsName = "RootMapNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "haptic", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setAppearance", returnType: CAPPluginReturnPromise)
    ]

    @objc func haptic(_ call: CAPPluginCall) {
        let kind = call.getString("kind") ?? "light"
        DispatchQueue.main.async {
            switch kind {
            case "selection": UISelectionFeedbackGenerator().selectionChanged()
            case "success": UINotificationFeedbackGenerator().notificationOccurred(.success)
            case "warning": UINotificationFeedbackGenerator().notificationOccurred(.warning)
            case "error": UINotificationFeedbackGenerator().notificationOccurred(.error)
            case "medium": UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            default: UIImpactFeedbackGenerator(style: .light).impactOccurred()
            }
        }
        call.resolve()
    }

    @objc func setAppearance(_ call: CAPPluginCall) {
        let dark = call.getBool("dark") ?? false
        let background = RootMapNativePlugin.color(hex: call.getString("background") ?? "")
        DispatchQueue.main.async { [weak self] in
            self?.bridge?.statusBarStyle = dark ? .lightContent : .darkContent
            if let background = background, let webView = self?.bridge?.webView {
                webView.backgroundColor = background
                webView.scrollView.backgroundColor = background
                webView.window?.backgroundColor = background
            }
        }
        call.resolve()
    }

    // "#rrggbb" → UIColor; nil for anything else.
    static func color(hex: String) -> UIColor? {
        let digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else { return nil }
        return UIColor(red: CGFloat((value >> 16) & 0xFF) / 255, green: CGFloat((value >> 8) & 0xFF) / 255, blue: CGFloat(value & 0xFF) / 255, alpha: 1)
    }
}
