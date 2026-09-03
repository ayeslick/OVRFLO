Feature: Watch surface
  Home is Your OVRFLO. After complete hydration the count/type matrix
  routes empty, detail, collection, or hub. Advanced keeps the role wall.
  Claim, withdraw, repay, and close live on the entity that owns them.

  Background:
    Given I am on the watch surface
    And my wallet is connected

  @UI-WATCH-EMPTY
  Scenario: Zero positions route to empty plus Create
    When I switch to a protocol-empty wallet
    Then I see the empty Your OVRFLO
    And the URL has no matrix query

  @UI-WATCH-BORROWED-DETAIL
  Scenario: One Self-Repaying Loan routes to loan detail
    Then the borrowed detail is open
    And the URL carries a loan identity

  @UI-WATCH-COLLECTION
  Scenario: Multiple Self-Repaying Loans route to the loan collection
    Given my wallet has a second Self-Repaying Loan
    And the frontend re-syncs with chain state
    Then the URL carries collection type "loan"
    And I see a loan row

  @UI-WATCH-HUB
  Scenario: Mixed types route to the hub with neither type nor identity
    Given my wallet has supplied liquidity to the active market
    And the frontend re-syncs with chain state
    Then I see the Your OVRFLO hub
    And the URL has no matrix query

  @UI-WATCH-WALL
  Scenario: Happy path — borrowed lens opens a loan detail in place
    When I select the "BORROWED" lens
    Then the watch wall is showing the "borrowed" lens
    And I see a loan row
    When I select the first loan row
    Then the borrowed detail is open
    And the URL carries a loan identity

  @UI-WATCH-SUPPLIED-DETAIL
  Scenario: Happy path — claim in place on a supplied position
    Given my wallet has supplied liquidity to the active market
    And the frontend re-syncs with chain state
    When I select the "SUPPLIED" lens
    And I select the first supply row
    Then the supplied detail is open
    When I start the in-place "WITHDRAW UNFILLED" write
    And I acknowledge risk if prompted
    And I confirm the watch write
    Then I see a confirmed action receipt

  @UI-WATCH-BORROWED-DETAIL
  Scenario: Identity churn — disconnect from an open loan detail
    When I select the "BORROWED" lens
    And I select the first loan row
    Then the borrowed detail is open
    When I disconnect my wallet
    Then I see the disconnected entry

  Scenario: Interruption — reload keeps the selected loan
    When I select the "BORROWED" lens
    And I select the first loan row
    Then the borrowed detail is open
    When the frontend re-syncs with chain state
    Then the borrowed detail is open
    And the URL carries a loan identity

  Scenario: Degraded reads — zero-count supplied lens is hidden
    When I select the "BORROWED" lens
    Then I see a loan row
    And the "SUPPLIED" lens is hidden
    And the "BORROWED" lens is visible

  Scenario: Outcomes — stale signing is labeled on the borrowed detail
    When I select the "BORROWED" lens
    And I select the first loan row
    Then the borrowed detail is open
    And I see text matching "EVENTS AS OF|SYNCED|DEGRADED|UNAVAILABLE"

  Scenario: Outcomes — a visible stream row matches lockup ownerOf
    Given my wallet holds a tracked eligible stream
    And the frontend re-syncs with chain state
    When I select the "STREAMS" lens
    Then I see a stream row for the tracked stream
    And each visible stream row matches lockup ownerOf

  Scenario: Responsive access — desktop and mobile mode reachability
    Given the viewport is 1280 by 800
    Then Go to Advanced is reachable
    And the page does not overflow horizontally
    Given the viewport is 360 by 800
    Then Go to Advanced is reachable
    And the page does not overflow horizontally
    And axe reports no serious violations
