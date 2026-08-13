Feature: First run
  A connected wallet confirmed empty of positions, loans, AND streams lands
  on the guided path. Discovery pending or could-not-ask never asserts
  emptiness. Skip yields the chooser. Borrow, Supply, and Assets stay
  launchable from nav.

  Background:
    Given I am on the watch surface

  @UI-WATCH-ENTRY-DISCONNECTED
  Scenario: Disconnected visitor sees entry, not a fake empty wall
    When I disconnect my wallet
    Then I see the disconnected entry
    And I do not see the first-run surface

  @UI-FIRST-RUN-SURFACE
  Scenario: Happy path — protocol-empty wallet gets the guided path
    When I switch to a protocol-empty wallet
    Then I see the first-run surface
    And I see the deposit intent

  Scenario: Skip yields the chooser, not an empty meter wall
    When I switch to a protocol-empty wallet
    Then I see the first-run surface
    When I click the "SKIP FOR NOW" button
    Then I see the first-run chooser

  @UI-FIRST-RUN-INTENT-DEPOSIT
  Scenario: Deposit intent launches Assets
    When I switch to a protocol-empty wallet
    And I follow the first-run deposit intent
    Then the assets route is open

  Scenario: Seeded holding wallet never gets first-run
    Given my wallet is connected
    Then I do not see the first-run surface
    And the watch wall is visible

  Scenario: Identity churn — reconnecting the holding wallet restores watch
    Given my wallet is connected
    When I disconnect my wallet
    Then I see the disconnected entry
    When I reconnect my wallet
    Then the watch wall is visible
    And I do not see the first-run surface
