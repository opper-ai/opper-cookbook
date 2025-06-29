# Experiment 0 – Boot-strapping Tiny GPT-4-mini Models

*“If I give the model just three winning positions, will it already crush its zero-shot sibling?”*  
This first experiment puts that to the test.

We pit six tiny GPT-4-mini variants against each other, varying two axes:
- **In-context learning**: 0 (zero-shot), 3, or 10 few-shot examples.  
- **Reasoning style**: Plain answer vs. Chain-of-Thought (*REASONING*).

By running 50 complete round-robins, we observe how quickly few-shot learning accumulates wins, whether reasoning helps or hinders tactical play, and how large the first-move edge becomes when no one plays perfectly.

---

## Tournament Setup (50 Rounds)

| Player                     | Strategy  | Few-shot *k* |
|---------------------------|-----------|---------------|
| gpt-4.1-mini-zero         | ZERO_SHOT | 0             |
| gpt-4.1-mini-few          | FEW_SHOT  | 3             |
| gpt-4.1-mini-many         | FEW_SHOT  | 10            |
| gpt-4.1-mini-reason       | REASONING | 0             |
| gpt-4.1-mini-reason-few   | REASONING | 3             |
| gpt-4.1-mini-reason-many  | REASONING | 10            |

Each round, every player faces every other player → \(\binom{6}{2} = 15\) matches per round, for a total of 750 matches.

---

## Scoring

- Win = 1  
- Tie = 0.5  
- Illegal = –1 (opponent gets +1)

We treat illegal moves as losses. Few-shot variants are expected to reduce these, as they see more correct move examples.

---

## Key Observations

**1. Few-shot examples dominate**  
After ~10 rounds, the 3-example players clearly pull ahead.

**2. Reasoning hurts at this scale**  
CoT variants output longer, messier responses and are more prone to illegal moves. They finish last. It only seems to help with the examples with a higher amount of examples passed. (Mini-reason-many)

**3. First-move advantage is real**  
Piece X wins ≈ 70% of decisive games. Even with fair shuffling, that edge is visible.

---

## First-Move Advantage

In our game setup, we flip a coin (50% chance) to decide who starts, and the starter receives piece 'X'.  
The code used to randomize starters in `Tournament._run_match` is:

```python
if random.choice([True, False]):
    x_player, o_player = p1, p2
else:
    x_player, o_player = p2, p1
```
### Why the starting side is so strong
1.	A perfect game is a tie, but these tiny GPT-4-mini derivatives still make tactical errors.  

2.	The opening move gives the first mover two opportunities to create a fork before the second player can even block one. A single slip from the opponent often turns that latent edge into a forced win.  

3.	Few-shot learning doesn’t remove that edge; it may even amplify it because the models continue to train on winning examples—many of which come from X, especially early in the tournament.


#### Wins by piece
```text
X_wins        480
O_wins        204
total_wins    684
X_win_rate    70.2 %
O_win_rate    29.8 %
```


### Decisive Winner Piece per Model

| Player                   | O Wins | X Wins |
|--------------------------|--------|--------|
| gpt-4.1-mini-few         | 4      | 127    |
| gpt-4.1-mini-many        | 24     | 102    |
| gpt-4.1-mini-reason      | 69     | 39     |
| gpt-4.1-mini-reason-few  | 12     | 68     |
| gpt-4.1-mini-reason-many | 27     | 90     |


## Plots
![Cumulative score](./assets/exp_0_cumulative_score.png)

Zoom on the first 10 rounds:
![First 10 rounds](./assets/exp_0_score_10_rounds.png)

Head-to-head matrix (rows = points *for*, columns = opponent):
![Heat-map](./assets/exp_0_heatmap.png)


