Feature: First run
  A connected wallet confirmed empty of positions and loans lands on
  empty Your OVRFLO plus Create. Discovery pending or could-not-ask never
  asserts emptiness. Borrow, Supply, and Assets stay launchable from nav.

  Background:
    Given I am on the watch surface

  @UI-WATCH-ENTRY-DISCONNECTED
  Scenario: Disconnected visitor sees entry, not a fake empty wall
    When I disconnect my wallet
    Then I see the disconnected entry
    And I do not see the first-run surface

  @UI-WATCH-EMPTY
  Scenario: Happy path — protocol-empty wallet gets empty plus Create
    When I switch to a protocol-empty wallet
    Then I see the empty Your OVRFLO
    And I do not see the first-run surface

  Scenario: Seeded holding wallet never gets first-run
    Given my wallet is connected
    Then I do not see the first-run surface
    And the borrowed detail is open

  Scenario: Identity churn — reconnecting the holding wallet restores watch
    Given my wallet is connected
    When I disconnect my wallet
    Then I see the disconnected entry
    When I reconnect my wallet
    Then the borrowed detail is open
    And I do not see the first-run surface
