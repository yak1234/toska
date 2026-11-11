kis_add_test(
    KisColorsmudgeOpTest.cpp
     $<TARGET_PROPERTY:kritatestsdk,SOURCE_DIR>/stroke_testing_utils.cpp
     ${CMAKE_CURRENT_SOURCE_DIR}/../KisColorSmudgeMixingOptionData.cpp
    TEST_NAME KisColorsmudgeOpTest
    LINK_LIBRARIES kritalibpaintop kritaimage kritatestsdk kritapaintmix
    )
target_include_directories(KisColorsmudgeOpTest PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/..)
