Feature: Deposit, claim, wrap, and unwrap
  Entry: the balances section of an expanded market row. Four independent
  conversions between PT, ovrfloToken, and underlying, each a single
  amount-and-confirm flow with no decision step. Exit: the balance row
  reflects the new token holdings.

  Background:
    Given I am on the markets page
    And my wallet is connected

  Scenario: Happy path — deposit PT for ovrfloToken and a stream
    When I expand the active market
    And I click the "DEPOSIT PT" button
    Then the "DEPOSIT PT" modal is open
    And I fill the amount field with "10"
    And I click the "APPROVE PT" button
    And I click the "DEPOSIT" button
    Then I see the caption "CONFIRMED"

  Scenario: Error state — deposit blocked by insufficient PT balance
    When I expand the active market
    And I click the "DEPOSIT PT" button
    Then the "DEPOSIT PT" modal is open
    And I fill the amount field with a value exceeding my PT balance
    Then I see the caption "INSUFFICIENT BALANCE"

  Scenario: Error state — deposit disabled once the market's deposit cap is reached
    Given the deposit cap for the active market is reached
    When I expand the active market
    And I click the "DEPOSIT PT" button
    Then the "DEPOSIT PT" modal is open
    Then I see text matching "DEPOSIT CAP REACHED"

  Scenario: Cross-cutting — DEPOSIT PT hides after maturity instead of showing a caption
    Given the market has matured
    When I expand the active market
    Then I do not see the caption "DEPOSIT PT"

  Scenario: Happy path — claim matured PT by burning ovrfloToken
    Given my wallet holds ovrfloToken from a deposit of "10"
    And the market has matured
    When I expand the active market
    And I click the "CLAIM PT" button
    Then the "CLAIM MATURED PT" modal is open
    And I fill the amount field with "1"
    And I click the "CLAIM" button
    Then I see the caption "CONFIRMED"

  Scenario: Happy path — wrap underlying into ovrfloToken
    When I expand the active market
    And I open the advanced panel
    And I click the "WRAP" button
    Then the "WRAP" modal is open
    And I fill the amount field with "1"
    And I click the "APPROVE wstETH" button
    And I click the "WRAP" button
    Then I see the caption "CONFIRMED"

  Scenario: Happy path — unwrap ovrfloToken back into underlying
    Given the wrap reserve holds "1"
    And my wallet holds ovrfloToken from a deposit of "10"
    When I expand the active market
    And I click the "UNWRAP" button
    Then the "UNWRAP" modal is open
    And I fill the amount field with "1"
    And I click the "UNWRAP" button
    Then I see the caption "CONFIRMED"

  Scenario: Error state — unwrap disabled when the wrap reserve is empty
    When I expand the active market
    Then the "UNWRAP" button is disabled
    And I see the caption "WRAP RESERVE EMPTY"
