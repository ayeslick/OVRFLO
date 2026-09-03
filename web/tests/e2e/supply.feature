Feature: Supply liquidity
  Entry: /supply/. Fixed Return supplies ovrfloToken at a selected APR tick.
  Decision stages follow SOURCE → UNDERLYING → AMOUNT → TERM → OUTCOME → REVIEW.

  Background:
    Given I am on the supply flow
    And my wallet is connected

  @UI-SUPPLY-SELECT-MARKET
  Scenario: Happy path — supply at a chosen rate lands on the watch wall
    When I select the first supply market
    And I click the "CONTINUE" button
    Then the supply amount step is open
    When I fill the amount field with "5"
    And I select the first available rate
    And I click the "REVIEW SUPPLY" button
    Then the supply review is open
    When I acknowledge risk if prompted
    And I approve the supply token if needed
    And I click the "SUPPLY" button
    Then I see a confirmed action receipt
    When I click the "VIEW POSITION" button
    Then the URL carries a position identity
    And the supplied detail is open

  @UI-SUPPLY-AMOUNT
  Scenario: Clamp — amount above wallet balance is refused before signing
    When I select the first supply market
    And I click the "CONTINUE" button
    And I fill the amount field with a value exceeding my wstETH balance
    Then I see a field error
    And the amount field error is associated

  Scenario: Identity churn — disconnect on review asks to re-enter
    When I select the first supply market
    And I click the "CONTINUE" button
    And I fill the amount field with "5"
    And I select the first available rate
    And I click the "REVIEW SUPPLY" button
    Then the supply review is open
    When I disconnect my wallet
    Then I see text matching "WALLET CHANGED|Connect a wallet"

  Scenario: Interruption — reload mid-amount does not invent a quote
    When I select the first supply market
    And I click the "CONTINUE" button
    And I fill the amount field with "5"
    When I reload the page
    Then the supply amount step is open

  Scenario: Outcomes — draining the wallet after approve reverts on submit
    When I select the first supply market
    And I click the "CONTINUE" button
    And I fill the amount field with "1"
    And I select the first available rate
    And I click the "REVIEW SUPPLY" button
    And I acknowledge risk if prompted
    And I approve the supply token if needed
    And my wstETH balance is drained
    And I click the "SUPPLY" button
    Then I see a mapped error message

  @UI-SUPPLY-SELECT-MARKET
  Scenario: Degraded reads — registry copy is distinct from an empty list
    Then the supply market picker is showing a non-loading state

  Scenario: Responsive access — heading focus and global mode
    Then the destination heading has focus
    And Go to Advanced is reachable
    And axe reports no serious violations
