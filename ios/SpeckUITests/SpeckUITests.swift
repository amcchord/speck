import XCTest

@MainActor final class SpeckUITests: XCTestCase {
  override func setUp() {
    continueAfterFailure = false
    XCUIDevice.shared.orientation = .portrait
  }
  private func launch() -> XCUIApplication {
    let app = XCUIApplication()
    app.launchArguments = ["--demo"]
    app.launch()
    XCTAssertTrue(app.navigationBars["Fleet"].waitForExistence(timeout: 15))
    XCTAssertTrue(app.staticTexts["BYD-EXAM01"].firstMatch.waitForExistence(timeout: 10))
    return app
  }
  private func capture(_ name: String, _ app: XCUIApplication) {
    let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
  func testFleetDeviceAndNavigation() {
    let app = launch()
    capture("fleet", app)
    app.staticTexts["BYD-EXAM01"].firstMatch.tap()
    XCTAssertTrue(app.navigationBars["BYD-EXAM01"].waitForExistence(timeout: 5))
    capture("machine", app)
    XCTAssertTrue(app.buttons["PowerShell"].exists)
    XCTAssertEqual(
      app.buttons["Screen"].frame.width, app.buttons["PowerShell"].frame.width, accuracy: 1)
    XCTAssertEqual(
      app.buttons["Screen"].frame.midY, app.buttons["PowerShell"].frame.midY, accuracy: 1)
    app.buttons["PowerShell"].tap()
    XCTAssertTrue(app.textViews["Script"].waitForExistence(timeout: 5))
    app.textViews["Script"].tap()
    app.textViews["Script"].typeText("Get-Service | Where-Object Status -eq 'Stopped'")
    XCTAssertEqual(
      app.textViews["Script"].value as? String, "Get-Service | Where-Object Status -eq 'Stopped'")
    if app.buttons["Hide keyboard"].exists { app.buttons["Hide keyboard"].tap() }
    capture("command", app)
    app.buttons["Done"].tap()
    app.staticTexts["Services"].tap()
    XCTAssertTrue(app.navigationBars["Services"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.staticTexts["Speck Agent"].exists)
    capture("services", app)
  }
  func testDarkAppearance() {
    // Set the simulator's appearance to dark before this capture pass.
    let app = XCUIApplication()
    app.launchArguments = ["--demo", "-AppleInterfaceStyle", "Dark"]
    app.launch()
    XCTAssertTrue(app.navigationBars["Fleet"].waitForExistence(timeout: 15))
    XCTAssertTrue(app.staticTexts["BYD-EXAM01"].firstMatch.waitForExistence(timeout: 10))
    capture("fleet-dark", app)
    app.staticTexts["BYD-EXAM01"].firstMatch.tap()
    XCTAssertTrue(app.navigationBars["BYD-EXAM01"].waitForExistence(timeout: 5))
    capture("machine-dark", app)
  }
  func testSignInLayout() {
    let app = XCUIApplication()
    app.launchArguments = ["--sign-in-preview"]
    app.launch()
    XCTAssertTrue(app.buttons["sign-in"].waitForExistence(timeout: 10))
    XCTAssertTrue(app.textFields["username"].exists)
    XCTAssertFalse(app.buttons["sign-in"].isEnabled)
    let masthead = app.descendants(matching: .any)["sign-in-masthead"].firstMatch
    XCTAssertTrue(masthead.exists)
    XCTAssertEqual(masthead.frame.minX, app.frame.minX, accuracy: 1)
    XCTAssertEqual(masthead.frame.width, app.frame.width, accuracy: 1)
    XCTAssertGreaterThanOrEqual(app.buttons["passkey-sign-in"].frame.height, 44)
    XCTAssertEqual(app.buttons["sign-in"].frame.width, app.buttons["passkey-sign-in"].frame.width, accuracy: 1)
    capture("sign-in", app)
    XCUIDevice.shared.orientation = .landscapeLeft
    defer { XCUIDevice.shared.orientation = .portrait }
    expectation(for: NSPredicate { _, _ in app.frame.width > app.frame.height }, evaluatedWith: app)
    waitForExpectations(timeout: 10)
    XCTAssertEqual(masthead.frame.width, app.frame.width, accuracy: 1)
    capture("sign-in-landscape", app)
  }
  func testMachinePanels() {
    for destination in ["Network", "Files", "Updates", "Job history"] {
      let app = launch()
      app.staticTexts["BYD-EXAM01"].firstMatch.tap()
      let link = app.staticTexts[destination].firstMatch
      if !link.isHittable { app.swipeUp() }
      XCTAssertTrue(link.isHittable)
      link.tap()
      let title = destination == "Job history" ? "Jobs" : destination
      XCTAssertTrue(app.navigationBars[title].waitForExistence(timeout: 5))
      capture(destination.lowercased(), app)
      app.terminate()
    }
  }
  func testSecondaryDestinations() {
    for (parent, destination) in [("Jobs", "Software & scripts"), ("Jobs", "Schedules"), ("Account", "Passkeys"), ("Account", "Privacy")] {
      let app = launch()
      app.buttons[parent].firstMatch.tap()
      let link = app.staticTexts[destination].firstMatch
      if !link.isHittable { app.swipeUp() }
      XCTAssertTrue(link.isHittable)
      link.tap()
      XCTAssertTrue(app.navigationBars[destination].waitForExistence(timeout: 5))
      capture(destination.lowercased(), app)
      app.terminate()
    }
  }
  func testLargeText() {
    let app = XCUIApplication()
    app.launchArguments = [
      "--demo", "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityM",
    ]
    app.launch()
    XCTAssertTrue(app.navigationBars["Fleet"].waitForExistence(timeout: 15))
    app.staticTexts["BYD-EXAM01"].firstMatch.tap()
    XCTAssertTrue(app.buttons["PowerShell"].isHittable)
    capture("machine-large-text", app)
  }
  func testLandscapeLayout() {
    let app = launch()
    app.staticTexts["BYD-EXAM01"].firstMatch.tap()
    XCUIDevice.shared.orientation = .landscapeLeft
    defer { XCUIDevice.shared.orientation = .portrait }
    expectation(for: NSPredicate { _, _ in app.frame.width > app.frame.height }, evaluatedWith: app)
    waitForExpectations(timeout: 10)
    XCTAssertTrue(app.buttons["PowerShell"].isHittable)
    capture("machine-landscape", app)
  }
  func testSearchFiltersFleet() {
    let app = launch()
    let search = app.searchFields.firstMatch
    XCTAssertTrue(search.waitForExistence(timeout: 10))
    search.tap()
    search.typeText("PBX")
    XCTAssertTrue(app.staticTexts["BYD-PBX"].waitForExistence(timeout: 5))
    XCTAssertFalse(app.staticTexts["BYD-FRONTDESK"].exists)
    capture("search", app)
  }
  func testPrimaryDestinations() {
    let app = launch()
    for title in ["Alerts", "Jobs", "Recovery", "Account"] {
      app.buttons[title].firstMatch.tap()
      XCTAssertTrue(app.navigationBars[title].waitForExistence(timeout: 5))
      capture(title.lowercased(), app)
    }
  }
}
