Feature: Adjust rate
  Entry: ADJUST RATE on an open liquidity position card. Decision: pick a new
  rate tick from the ladder; the full idle balance moves automatically — no
  amount entry. Exit: the position's card shows the new rate.

  Background:
    Given the market offers multiple rate ticks
    And I am on the markets page
    And my wallet is connected

  Scenario: Happy path — move idle liquidity to a new rate
    Given my wallet has supplied liquidity to the active market
    And the frontend re-syncs with chain state
    When I expand the active market
    And I click the "ADJUST RATE" button
    Then the "ADJUST RATE" modal is open
    When I select the second available rate
    And I click the "APPROVE" button
    And I click the "ADJUST RATE" button
    Then I see the caption "CONFIRMED"

  Scenario: Error state — idle amount changes after the form opens
    Given my wallet has supplied liquidity to the active market
    And the frontend re-syncs with chain state
    When I expand the active market
    And I click the "ADJUST RATE" button
    Then the "ADJUST RATE" modal is open
    When I select the second available rate
    And I click the "APPROVE" button
    And another borrower draws down that liquidity before I confirm
    And I click the "ADJUST RATE" button
    Then I see the caption "IDLE AMOUNT CHANGED SINCE THE FORM OPENED — REVIEW THE NEW NUMBER AND RE-CONFIRM"
    And the "RE-CONFIRM ADJUST RATE" button is enabled

  Scenario: Cross-cutting — market matured disables the move with a caption
    Given my wallet has supplied liquidity to the active market
    And the market has matured
    When I expand the active market
    And I click the "ADJUST RATE" button
    Then the "ADJUST RATE" modal is open
    Then I see the caption "MARKET MATURED — RATES CLOSED"
