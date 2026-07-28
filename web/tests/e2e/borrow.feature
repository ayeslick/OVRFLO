# "Insufficient balance" from the plan's R11 borrow row has no reachable
# equivalent in this form: BORROW pays the borrower out of pledged-liquidity
# depth, not their own wallet balance, so there is no wallet-balance guard to
# violate (confirmed against borrow-form.test.tsx, which has no such case
# either). "No liquidity posted" is the closest real analog — an empty ladder
# that keeps the submit control disabled with a reason shown — and stands in
# for it below.
Feature: Borrow against a stream
  Entry: BORROW action on a lending market card. Decision: selecting a stream,
  a liquidity rung, and a slippage tolerance. Exit: a new loan appears in the
  borrower's loan book and the borrowed amount reaches the wallet.

  Background:
    Given I am on the markets page
    And my wallet is connected

  Scenario: Happy path — borrow against a stream via the rate ladder
    Given a lender has posted liquidity for the active market
    And my wallet holds an eligible stream
    And the frontend re-syncs with chain state
    When I expand the active market
    And I click the "BORROW" button
    Then the "BORROW AGAINST STREAM" modal is open
    When I select the first available stream
    And I select the first available rate
    And I fill the amount field with "1"
    And I click the "APPROVE STREAM" button
    And I click the "BORROW" button
    Then I see text matching "RECEIVED"
    When I click the "CLOSE" button
    Then no modal is open
    When I expand the active market
    Then I see a "LOAN" position card

  Scenario: Error state — no liquidity posted for this market
    Given my wallet holds an eligible stream
    And the frontend re-syncs with chain state
    When I expand the active market
    And I click the "BORROW" button
    Then the "BORROW AGAINST STREAM" modal is open
    When I select the first available stream
    And I click the "APPROVE STREAM" button
    Then I see the caption "NO LIQUIDITY POSTED AT ANY RATE"
    And the "BORROW" button is disabled

  Scenario: Error state — invalid slippage
    Given a lender has posted liquidity for the active market
    And my wallet holds an eligible stream
    And the frontend re-syncs with chain state
    When I expand the active market
    And I click the "BORROW" button
    Then the "BORROW AGAINST STREAM" modal is open
    When I select the first available stream
    And I select the first available rate
    And I fill the amount field with "1"
    And I fill the slippage field with "10"
    Then I see the caption "SLIPPAGE MUST BE 0.1–5%"
    And I click the "APPROVE STREAM" button
    And the "BORROW" button is disabled

  Scenario: Error state — stale liquidity triggers an automatic re-quote, not a dead end
    Given a lender has posted liquidity for the active market
    And my wallet holds an eligible stream
    And the frontend re-syncs with chain state
    When I expand the active market
    And I click the "BORROW" button
    Then the "BORROW AGAINST STREAM" modal is open
    When I select the first available stream
    And I select the first available rate
    And I fill the amount field with "1"
    And I click the "APPROVE STREAM" button
    And the posted liquidity is withdrawn by the lender
    And I click the "BORROW" button
    Then I see the caption "LIQUIDITY CHANGED SINCE YOUR QUOTE — REVIEW THE NEW NUMBER AND RE-CONFIRM"
    And I see text matching "RE-CONFIRM BORROW"

  Scenario: Cross-cutting — market matured disables BORROW with a caption
    Given the market has matured
    When I expand the active market
    Then the "BORROW" button is disabled
    And I see the caption "MARKET MATURED"

  Scenario: Cross-cutting — focus trap and Escape (AE2)
    Given a lender has posted liquidity for the active market
    And my wallet holds an eligible stream
    And the frontend re-syncs with chain state
    When I expand the active market
    And I click the "BORROW" button
    Then the "BORROW AGAINST STREAM" modal is open
    And focus is trapped within the "BORROW AGAINST STREAM" modal
    When I press Escape
    Then no modal is open
    And focus returns to the "BORROW" button
