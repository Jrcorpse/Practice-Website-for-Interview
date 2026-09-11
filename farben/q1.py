def highestScore(nums):
    total_numbers = len(nums)
    dp_grid = []
    for i in range(total_numbers):
        row = []
        for j in range(total_numbers):
            row.append(0)
        dp_grid.append(row)
        
  
    for i in range(total_numbers):
        dp_grid[i][i] = nums[i]
        
     for current_length in range(2, total_numbers + 1):
        for left_index in range(total_numbers - current_length + 1):
            right_index = left_index + current_length - 1
            
            pick_left = nums[left_index] - dp_grid[left_index + 1][right_index]
            
            pick_right = nums[right_index] - dp_grid[left_index][right_index - 1]
            
            if pick_left > pick_right:
                dp_grid[left_index][right_index] = pick_left
            else:
                dp_grid[left_index][right_index] = pick_right
               
       total_sum = sum(nums)
    score_difference = dp_grid[0][total_numbers - 1]
    
    john_final_score = (total_sum + score_difference) // 2
    return john_final_score
