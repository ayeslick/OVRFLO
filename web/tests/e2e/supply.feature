Feature: Supply liquidity
  Entry: /supply. Decision: SELECT_MARKET → amount → rate → review → approve
  (if needed) → confirm. Exit: /?lens=supplied&position= on the watch wall.

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
    Then the URL carries the supplied lens and a position id
    And the supplied detail is open

  @UI-SUPPLY-AMOUNT
  Scenario: Clamp — amount above wallet balance is refused before signing
    When I select the first supply market
    And I click the "CONTINUE" button
    And I fill the amount field with a value exceeding my wstETH balance
    Then I see a field error
    And the "REVIEW SUPPLY" button is disabled

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
