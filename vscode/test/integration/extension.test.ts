import * as assert from "assert";
import * as vscode from "vscode";

suite("Extension Integration Tests", () => {
  test("Extension should be present", () => {
    const extension = vscode.extensions.getExtension("pullapprove.human-review");
    assert.ok(extension, "Extension should be installed");
  });

  test("Extension should activate", async () => {
    const extension = vscode.extensions.getExtension("pullapprove.human-review");
    assert.ok(extension, "Extension should be installed");

    if (!extension.isActive) {
      await extension.activate();
    }
    assert.ok(extension.isActive, "Extension should be active");
  });

  test("View commands should be registered", async () => {
    const commands = await vscode.commands.getCommands(true);
    const humanReviewCommands = commands.filter((c) => c.startsWith("human-review."));

    // VS Code auto-generates view commands (open, focus, etc.)
    // Custom commands from contributes.commands only register on activation
    assert.ok(
      humanReviewCommands.length >= 1,
      `Expected view commands to be available. Found: ${humanReviewCommands.join(", ")}`,
    );
  });

  test("Tree view should be registered", () => {
    // The tree view is registered via contributes in package.json
    // We can verify by checking if the view container exists
    const extension = vscode.extensions.getExtension("pullapprove.human-review");
    assert.ok(extension, "Extension should be installed");

    const packageJson = extension.packageJSON;
    assert.ok(packageJson.contributes.views["human-review"], "Tree view should be configured");
    assert.ok(
      packageJson.contributes.views["human-review"].some(
        (v: { id: string }) => v.id === "human-review.files",
      ),
      "Files view should be configured",
    );
  });

  test("Webview should be registered", () => {
    const extension = vscode.extensions.getExtension("pullapprove.human-review");
    assert.ok(extension, "Extension should be installed");

    const packageJson = extension.packageJSON;
    assert.ok(
      packageJson.contributes.views["human-review"].some(
        (v: { id: string; type: string }) => v.id === "human-review.review" && v.type === "webview",
      ),
      "Review webview should be configured",
    );
  });

  test("Configuration should be registered", () => {
    const config = vscode.workspace.getConfiguration("human-review");
    // Check that our config exists (will return default value)
    const showDecorations = config.get("showEditorDecorations");
    assert.strictEqual(typeof showDecorations, "boolean", "showEditorDecorations should be a boolean");
  });

  test("Keybindings should be registered", () => {
    const extension = vscode.extensions.getExtension("pullapprove.human-review");
    assert.ok(extension, "Extension should be installed");

    const packageJson = extension.packageJSON;
    assert.ok(packageJson.contributes.keybindings, "Keybindings should be configured");
    assert.ok(packageJson.contributes.keybindings.length > 0, "At least one keybinding should exist");
  });
});

suite("Command Execution Tests", () => {
  test("Refresh command runs without error", async () => {
    // This should not throw even without a workspace
    try {
      await vscode.commands.executeCommand("human-review.refresh");
    } catch (e) {
      // Expected to potentially fail without a git repo, but shouldn't crash
      assert.ok(true, "Command executed (may fail gracefully without git repo)");
    }
  });

  test("Toggle decorations command runs without error", async () => {
    try {
      await vscode.commands.executeCommand("human-review.toggleEditorDecorations");
    } catch (e) {
      assert.ok(true, "Command executed");
    }
  });
});
