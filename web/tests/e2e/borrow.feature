Feature: Borrow against a stream
  Entry: /borrow/. Decision stages follow SOURCE → UNDERLYING → AMOUNT → TERM →
  OUTCOME → REVIEW. An eligible stream fixes AMOUNT. Typed create stays on
  /borrow/. Exit: /?lending=<market>&loan= on Your OVRFLO.

  Background:
    Given I am on the borrow flow
    And my wallet is connected

  @UI-BORROW-SELECT-STREAM
  Scenario: Happy path — borrow against a stream lands on the watch wall
    Given a lender has posted liquidity for the active market
    And my wallet holds an eligible stream
    And the frontend re-syncs with chain state
    When I select the first available stream
    And I click the "CONTINUE" button
    Then the borrow outcome step is open
    And I select the first available rate
    And I click the "REVIEW BORROW" button
    Then the borrow review is open
    When I acknowledge risk if prompted
    And I click the "APPROVE STREAM" button if it is shown
    And I click the "BORROW" button
    Then I see a confirmed action receipt
    When I click the "VIEW LOAN" button
    Then the URL carries a loan identity
    And the borrowed detail is open

  Scenario: Error state — no eligible stream offers Assets, not a fake empty book
    Then I see the no-eligible-stream handoff

  Scenario: Clamp — empty tick keeps review disabled
    Given my wallet holds an eligible stream
    And the frontend re-syncs with chain state
    When I select the first available stream
    And I click the "CONTINUE" button
    Then I see text matching "NO LIQUIDITY POSTED AT ANY RATE"
    And the "REVIEW BORROW" button is disabled

  Scenario: Outcomes — stale liquidity after approve asks for re-review
    Given a lender has posted liquidity for the active market
    And my wallet holds an eligible stream
    And the frontend re-syncs with chain state
    When I select the first available stream
    And I click the "CONTINUE" button
    And I select the first available rate
    And I click the "REVIEW BORROW" button
    And I acknowledge risk if prompted
    And I click the "APPROVE STREAM" button if it is shown
    And the posted liquidity is withdrawn by the lender
    And I click the "BORROW" button
    Then I see text matching "QUOTE UPDATED|REVIEW AGAIN"

  Scenario: Identity churn — disconnect on review asks to re-enter
    Given a lender has posted liquidity for the active market
    And my wallet holds an eligible stream
    And the frontend re-syncs with chain state
    When I select the first available stream
    And I click the "CONTINUE" button
    And I select the first available rate
    And I click the "REVIEW BORROW" button
    Then the borrow review is open
    When I disconnect my wallet
    Then I see text matching "WALLET CHANGED|Connect a wallet"

  Scenario: Interruption — reload mid-amount does not keep a frozen quote
    Given a lender has posted liquidity for the active market
    And my wallet holds an eligible stream
    And the frontend re-syncs with chain state
    When I select the first available stream
    And I click the "CONTINUE" button
    When I reload the page
    Then the borrow outcome step is open
