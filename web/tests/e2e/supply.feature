Feature: Supply liquidity
  Entry: SUPPLY action on a lending market card. Decision: approve (if needed)
  then confirm an amount at a chosen rate. Exit: a new liquidity position
  appears for that market.

  Background:
    Given I am on the markets page
    And my wallet is connected

  Scenario: Happy path — supply liquidity at a chosen rate
    When I expand the active market
    And I click the "SUPPLY" button
    Then the "SUPPLY LIQUIDITY" modal is open
    When I select the first available rate
    And I fill the amount field with "5"
    And I click the "APPROVE" button
    And I click the button matching "^SUPPLY @"
    Then I see the caption "CONFIRMED"
    When I click the "CLOSE" button
    Then no modal is open
    When I expand the active market
    Then I see a "LIQUIDITY" position card

  Scenario: Error state — insufficient balance
    When I expand the active market
    And I click the "SUPPLY" button
    Then the "SUPPLY LIQUIDITY" modal is open
    When I select the first available rate
    And I fill the amount field with a value exceeding my wstETH balance
    Then I see the caption "INSUFFICIENT BALANCE"
    And the button matching "^SUPPLY @|^APPROVE$" is disabled

  Scenario: Error state — transaction reverts
    When I expand the active market
    And I click the "SUPPLY" button
    Then the "SUPPLY LIQUIDITY" modal is open
    When I select the first available rate
    And I fill the amount field with "1"
    And I click the "APPROVE" button
    And my wstETH balance is drained
    And I click the button matching "^SUPPLY @"
    Then I see a mapped error message
    And the "SUPPLY LIQUIDITY" modal is open
    And the button matching "^SUPPLY @" is enabled

  Scenario: Cross-cutting — market matured disables SUPPLY with a caption
    Given the market has matured
    When I expand the active market
    Then the "SUPPLY" button is disabled
    And I see the caption "MARKET MATURED"

  Scenario Outline: Cross-cutting — responsive layout at <width>px
    Given the viewport is <width> by <height>
    When I expand the active market
    Then the "SUPPLY" button is enabled

    Examples:
      | width | height |
      | 800   | 900    |
      | 1200  | 900    |
